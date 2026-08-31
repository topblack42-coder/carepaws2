const crypto = require("crypto");
const Payment = require("../models/Payment");
const { buildListQuery, buildSort, buildPagination } = require("../utils/queryBuilder");
const { notifyOnce } = require("../utils/notificationHelper");
const logger = require("../utils/logger");

const PAYMONGO_API = "https://api.paymongo.com/v1";

function paymongoAuthHeader() {
  const key = process.env.PAYMONGO_SECRET_KEY || "";
  return `Basic ${Buffer.from(`${key}:`).toString("base64")}`;
}

function receiptUrl(req, paymentId) {
  const base = process.env.PAYMENT_RECEIPT_BASE_URL || `${req.protocol}://${req.get("host")}`;
  return `${base.replace(/\/$/, "")}/api/payments/${paymentId}/receipt`;
}

function extractWebhookEvent(req) {
  const body = req.body || {};
  const eventData = body.data || {};
  const attributes = eventData.attributes || {};
  const resource = attributes.data || body.data?.data || {};
  const eventType = attributes.type || body.event_type || body.type;
  const eventId = eventData.id || body.id || crypto.createHash("sha256").update(req.rawBody || JSON.stringify(body)).digest("hex");
  return { eventId, eventType, resource };
}

function extractPaymentData(eventType, resource) {
  const attributes = resource?.attributes || {};
  const payments = Array.isArray(attributes.payments) ? attributes.payments : [];
  const payment = payments.find((entry) => entry?.attributes?.status === "paid") || payments[payments.length - 1];
  const paymentId = eventType === "checkout_session.payment.paid" ? payment?.id : resource?.id;
  const paymentAttributes = payment?.attributes || attributes;
  const referenceNumber =
    attributes.reference_number ||
    attributes.external_reference_number ||
    paymentAttributes.reference_number ||
    paymentAttributes.external_reference_number ||
    attributes.checkout_session?.reference_number;
  const relatedPaymentId = attributes.payment_id || paymentAttributes.payment_id || paymentId;
  return { paymentId, relatedPaymentId, referenceNumber, paymentAttributes };
}

async function findPaymentByReference(referenceNumber, relatedPaymentId) {
  const conditions = [];
  if (referenceNumber) {
    conditions.push({ paymongoCheckoutSessionId: referenceNumber });
    if (/^[a-f0-9]{24}$/i.test(String(referenceNumber))) conditions.push({ _id: referenceNumber });
  }
  if (relatedPaymentId) conditions.push({ paymongoPaymentId: relatedPaymentId });
  if (!conditions.length) return null;
  return Payment.findOne({ $or: conditions });
}

// POST /api/payments/create-checkout
async function createCheckout(req, res, next) {
  try {
    const { type, amount, description, refModel, refId } = req.body;

    if (!process.env.PAYMONGO_SECRET_KEY) {
      return res.status(503).json({ success: false, message: "Payment gateway is not configured (PAYMONGO_SECRET_KEY missing)" });
    }

    const payment = await Payment.create({
      paidBy: req.user._id,
      type,
      amount,
      description,
      refModel: refModel || null,
      refId: refId || null,
      status: "pending",
    });

    try {
      const checkoutRes = await fetch(`${PAYMONGO_API}/checkout_sessions`, {
        method: "POST",
        headers: { Authorization: paymongoAuthHeader(), "Content-Type": "application/json" },
        body: JSON.stringify({
          data: {
            attributes: {
              line_items: [{ currency: "PHP", amount, name: description, quantity: 1 }],
              payment_method_types: ["gcash", "card", "paymaya", "grab_pay"],
              description,
              success_url: `${process.env.MOBILE_APP_URL}payment/success?paymentId=${payment._id}`,
              cancel_url: `${process.env.MOBILE_APP_URL}payment/cancel?paymentId=${payment._id}`,
              reference_number: payment._id.toString(),
            },
          },
        }),
      });

      const checkoutData = await checkoutRes.json();
      if (!checkoutRes.ok) {
        await Payment.findByIdAndDelete(payment._id);
        logger.error({ checkoutData }, "PayMongo checkout session creation failed");
        return res.status(502).json({ success: false, message: "Failed to create checkout session" });
      }

      payment.paymongoCheckoutSessionId = checkoutData.data.id;
      payment.paymongoStatus = checkoutData.data.attributes?.status || "active";
      payment.paymongoCheckoutUrl = checkoutData.data.attributes.checkout_url;
      await payment.save();
      await notifyOnce({
        recipient: payment.paidBy,
        type: "PAYMENT_PENDING",
        title: "Payment pending",
        message: `Your payment of ₱${(payment.amount / 100).toFixed(2)} is pending PayMongo confirmation.`,
        refModel: "Payment",
        refId: payment._id,
        dedupeKey: `payment-pending:${payment._id}`,
      });

      return res.status(201).json({ success: true, data: payment });
    } catch (err) {
      await Payment.findByIdAndDelete(payment._id);
      throw err;
    }
  } catch (err) {
    next(err);
  }
}

// POST /api/payments/webhook — gateway -> server
async function webhook(req, res, next) {
  try {
    const signature = req.headers["paymongo-signature"];
    const secret = process.env.PAYMONGO_WEBHOOK_SECRET;

    if (!secret) {
      logger.error("PAYMONGO_WEBHOOK_SECRET is not configured — rejecting webhook");
      return res.status(500).json({ success: false, message: "Webhook not configured" });
    }
    if (!signature) return res.status(401).json({ success: false, message: "Missing webhook signature" });

    const raw = req.rawBody ? req.rawBody : Buffer.from(JSON.stringify(req.body));
    const expected = crypto.createHmac("sha256", secret).update(raw).digest("hex");
    const valid =
      expected.length === signature.length &&
      crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
    if (!valid) {
      // This is the one webhook failure mode that used to return silently
      // with no log line at all — every other branch (missing secret,
      // an uncaught exception) logs, so a mismatched
      // PAYMONGO_WEBHOOK_SECRET (e.g. after rotating/recreating the
      // webhook in PayMongo's dashboard without updating this env var)
      // was indistinguishable from the request never reaching the server
      // in the first place. Never log the signature or secret values
      // themselves — just the fact of a mismatch, which is enough to
      // point at "check PAYMONGO_WEBHOOK_SECRET" instead of chasing
      // network/connectivity theories.
      logger.error("PayMongo webhook signature mismatch — check PAYMONGO_WEBHOOK_SECRET matches the active webhook's secret in the PayMongo dashboard");
      return res.status(401).json({ success: false, message: "Invalid webhook signature" });
    }

    const { eventId, eventType, resource } = extractWebhookEvent(req);
    const { paymentId, relatedPaymentId, referenceNumber, paymentAttributes } = extractPaymentData(eventType, resource);
    const payment = await findPaymentByReference(referenceNumber, relatedPaymentId);

    if (!payment) return res.status(200).json({ success: true, message: "Unknown payment reference — ignored" });

    const baseUpdate = {
      $addToSet: { webhookEventIds: eventId },
      $set: { paymongoStatus: paymentAttributes?.status || eventType },
    };
    if (paymentId) baseUpdate.$set.paymongoPaymentId = paymentId;

    let updated = null;
    let notification = null;

    if (eventType === "payment.paid" || eventType === "checkout_session.payment.paid") {
      if (payment.status !== "refunded") {
        updated = await Payment.findOneAndUpdate(
          { _id: payment._id, webhookEventIds: { $ne: eventId }, status: { $nin: ["paid", "refunded"] } },
          {
            ...baseUpdate,
            $set: {
              ...baseUpdate.$set,
              status: "paid",
              paidAt: payment.paidAt || new Date(),
              receiptUrl: payment.receiptUrl || receiptUrl(req, payment._id),
              paymentMethod: paymentAttributes?.source?.type || paymentAttributes?.payment_method?.type || payment.paymentMethod,
            },
          },
          { new: true }
        );
        if (updated) {
          notification = {
            recipient: payment.paidBy,
            type: "PAYMENT_RECEIVED",
            title: "Payment received",
            message: `Your payment of ₱${(payment.amount / 100).toFixed(2)} was received.`,
            refModel: "Payment",
            refId: payment._id,
          };
        }
      }
    } else if (eventType === "payment.failed") {
      updated = await Payment.findOneAndUpdate(
        { _id: payment._id, webhookEventIds: { $ne: eventId }, status: { $nin: ["paid", "refunded", "failed"] } },
        { ...baseUpdate, $set: { ...baseUpdate.$set, status: "failed" } },
        { new: true }
      );
      if (updated) {
        notification = {
          recipient: payment.paidBy,
          type: "PAYMENT_FAILED",
          title: "Payment failed",
          message: `Your payment of ₱${(payment.amount / 100).toFixed(2)} could not be processed.`,
          refModel: "Payment",
          refId: payment._id,
        };
      }
    } else if (eventType === "payment.refunded" || eventType === "refund.succeeded" || eventType === "payment.refund.updated") {
      const refundStatus = paymentAttributes?.status || resource?.attributes?.status;
      if (refundStatus === "succeeded" || eventType === "payment.refunded") {
        updated = await Payment.findOneAndUpdate(
          { _id: payment._id, webhookEventIds: { $ne: eventId }, status: { $ne: "refunded" } },
          { ...baseUpdate, $set: { ...baseUpdate.$set, status: "refunded", refundedAt: new Date(), paymongoRefundId: resource?.id || payment.paymongoRefundId } },
          { new: true }
        );
        if (updated) {
          notification = {
            recipient: payment.paidBy,
            type: "PAYMENT_REFUNDED",
            title: "Payment refunded",
            message: `Your payment of ₱${(payment.amount / 100).toFixed(2)} has been refunded.`,
            refModel: "Payment",
            refId: payment._id,
          };
        }
      }
    } else if (eventType === "checkout_session.expired") {
      updated = await Payment.findOneAndUpdate(
        { _id: payment._id, webhookEventIds: { $ne: eventId }, status: "pending" },
        { ...baseUpdate, $set: { ...baseUpdate.$set, status: "cancelled" } },
        { new: true }
      );
    } else {
      // Record unknown events for idempotency/audit without changing payment state.
      await Payment.updateOne({ _id: payment._id }, { $addToSet: { webhookEventIds: eventId } });
    }

    if (notification) await notifyOnce({ ...notification, dedupeKey: `payment-event:${payment._id}:${eventType}:${eventId}` });

    return res.status(200).json({ success: true });
  } catch (err) {
    next(err);
  }
}

// POST /api/payments/:id/cancel — expire the real PayMongo checkout session, then persist cancellation
async function cancel(req, res, next) {
  try {
    const payment = await Payment.findOne({ _id: req.params.id, paidBy: req.user._id });
    if (!payment) return res.status(404).json({ success: false, message: "Payment not found" });
    if (payment.status !== "pending") return res.status(409).json({ success: false, message: `Payment is already ${payment.status}` });
    if (!payment.paymongoCheckoutSessionId) return res.status(409).json({ success: false, message: "PayMongo checkout session is missing" });
    if (!process.env.PAYMONGO_SECRET_KEY) return res.status(503).json({ success: false, message: "Payment gateway is not configured" });

    const expireRes = await fetch(`${PAYMONGO_API}/checkout_sessions/${payment.paymongoCheckoutSessionId}/expire`, {
      method: "POST",
      headers: { Authorization: paymongoAuthHeader(), "Content-Type": "application/json" },
    });
    const expireData = await expireRes.json();
    if (!expireRes.ok) {
      logger.error({ expireData, paymentId: payment._id }, "PayMongo checkout expiration failed");
      return res.status(502).json({ success: false, message: "PayMongo checkout could not be cancelled" });
    }

    const providerStatus = expireData?.data?.attributes?.status;
    if (providerStatus !== "expired") {
      return res.status(202).json({ success: true, data: payment, message: "Cancellation is still pending PayMongo confirmation" });
    }

    payment.status = "cancelled";
    payment.paymongoStatus = providerStatus;
    await payment.save();
    await notifyOnce({
      recipient: payment.paidBy,
      type: "PAYMENT_CANCELLED",
      title: "Payment cancelled",
      message: `Your payment of ₱${(payment.amount / 100).toFixed(2)} was cancelled.`,
      refModel: "Payment",
      refId: payment._id,
      dedupeKey: `payment-cancelled:${payment._id}`,
    });
    return res.json({ success: true, data: payment });
  } catch (err) {
    next(err);
  }
}

// GET /api/payments/my
async function myPayments(req, res, next) {
  try {
    const payments = await Payment.find({ paidBy: req.user._id }).sort({ createdAt: -1 });
    return res.json({ success: true, data: payments });
  } catch (err) {
    next(err);
  }
}

// GET /api/payments/my/:id
async function myPaymentDetail(req, res, next) {
  try {
    const payment = await Payment.findOne({ _id: req.params.id, paidBy: req.user._id });
    if (!payment) return res.status(404).json({ success: false, message: "Payment not found" });
    return res.json({ success: true, data: payment });
  } catch (err) {
    next(err);
  }
}

// GET /api/payments/:id/receipt — real receipt generated from the stored payment record
async function receipt(req, res, next) {
  try {
    const payment = await Payment.findOne({ _id: req.params.id, paidBy: req.user._id });
    if (!payment) return res.status(404).json({ success: false, message: "Payment not found" });
    if (payment.status !== "paid" && payment.status !== "refunded") {
      return res.status(409).json({ success: false, message: "Receipt is available after payment is confirmed" });
    }

    const amount = `₱${(payment.amount / 100).toFixed(2)}`;
    const status = payment.status === "refunded" ? "Refunded" : "Paid";
    const date = (payment.paidAt || payment.createdAt).toISOString();
    res.type("html").send(`<!doctype html><html><head><meta charset="utf-8"><title>CarePaws Receipt</title><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="font-family:Arial,sans-serif;max-width:640px;margin:40px auto;padding:24px;color:#222"><h1>CarePaws</h1><h2>Payment Receipt</h2><p><strong>Status:</strong> ${status}</p><p><strong>Reference:</strong> ${payment._id}</p><p><strong>Type:</strong> ${payment.type.replace(/_/g, " ")}</p><p><strong>Amount:</strong> ${amount} ${payment.currency}</p><p><strong>Date:</strong> ${date}</p><p><strong>Payment method:</strong> ${payment.paymentMethod || "—"}</p>${payment.description ? `<p><strong>Description:</strong> ${payment.description}</p>` : ""}</body></html>`);
  } catch (err) {
    next(err);
  }
}

// GET /api/payments — staff
async function list(req, res, next) {
  try {
    const filter = buildListQuery(req.query, { filterFields: ["status", "type", "paidBy"], allowIncludeDeleted: true });
    const sort = buildSort(req.query);
    const total = await Payment.countDocuments(filter);
    const { page, limit, skip, ...paginationRest } = buildPagination(total, req.query.page, req.query.limit);
    const data = await Payment.find(filter).populate("paidBy", "displayName email").sort(sort).skip(skip).limit(limit);
    return res.json({ success: true, data, pagination: { page, limit, ...paginationRest } });
  } catch (err) {
    next(err);
  }
}

// GET /api/payments/summary — staff
async function summary(req, res, next) {
  try {
    const result = await Payment.aggregate([
      { $match: { status: "paid" } },
      { $group: { _id: "$type", total: { $sum: "$amount" }, count: { $sum: 1 } } },
    ]);
    return res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

// GET /api/payments/:id — staff
async function getOne(req, res, next) {
  try {
    const payment = await Payment.findById(req.params.id).populate("paidBy", "displayName email");
    if (!payment) return res.status(404).json({ success: false, message: "Payment not found" });
    return res.json({ success: true, data: payment });
  } catch (err) {
    next(err);
  }
}

// PUT /api/payments/:id/refund — staff
async function refund(req, res, next) {
  try {
    const payment = await Payment.findById(req.params.id);
    if (!payment) return res.status(404).json({ success: false, message: "Payment not found" });
    if (payment.status !== "paid") return res.status(409).json({ success: false, message: "Only paid payments can be refunded" });
    if (!payment.paymongoPaymentId) return res.status(409).json({ success: false, message: "PayMongo payment reference is missing; refund cannot be processed" });
    if (!process.env.PAYMONGO_SECRET_KEY) return res.status(503).json({ success: false, message: "Payment gateway is not configured" });

    const reason = req.body.reason || "others";
    const refundRes = await fetch(`${PAYMONGO_API}/refunds`, {
      method: "POST",
      headers: { Authorization: paymongoAuthHeader(), "Content-Type": "application/json" },
      body: JSON.stringify({
        data: {
          attributes: {
            amount: payment.amount,
            payment_id: payment.paymongoPaymentId,
            reason,
            notes: req.body.reason || `Refund for CarePaws payment ${payment._id}`,
          },
        },
      }),
    });
    const refundData = await refundRes.json();
    if (!refundRes.ok) {
      logger.error({ refundData, paymentId: payment._id }, "PayMongo refund request failed");
      return res.status(502).json({ success: false, message: "PayMongo refund request failed" });
    }

    const refundStatus = refundData?.data?.attributes?.status;
    payment.paymongoRefundId = refundData?.data?.id || payment.paymongoRefundId;
    payment.paymongoRefundStatus = refundStatus || "pending";
    payment.notes = `${payment.notes || ""}\nRefund requested: ${req.body.reason || "n/a"}`.trim();

    // The local payment is marked refunded only after PayMongo reports a successful refund.
    if (refundStatus === "succeeded") {
      payment.status = "refunded";
      payment.refundedAt = new Date();
    }
    await payment.save();

    return res.status(refundStatus === "succeeded" ? 200 : 202).json({ success: true, data: payment });
  } catch (err) {
    next(err);
  }
}

module.exports = { createCheckout, webhook, cancel, myPayments, myPaymentDetail, receipt, list, summary, getOne, refund };