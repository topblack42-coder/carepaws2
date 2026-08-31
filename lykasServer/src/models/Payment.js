const mongoose = require("mongoose");

const paymentSchema = new mongoose.Schema(
  {
    paidBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    // Extended from the source's ["donation"]-only enum per §4/§5.2 — the
    // intended UX flow (adoption fee payment) needs this.
    type: { type: String, enum: ["donation", "adoption_fee", "event_fee"], required: true },
    amount: { type: Number, required: true }, // integer, PHP centavos
    currency: { type: String, default: "PHP" },
    description: { type: String },
    refModel: { type: String, enum: ["Application", "Event", null], default: null },
    refId: { type: mongoose.Schema.Types.ObjectId, default: null },
    paymongoPaymentId: { type: String },
    paymongoCheckoutSessionId: { type: String, index: true },
    // Captured at checkout-session creation time (from the session's
    // nested payment_intent.id), not learned later from a successful
    // payment. Unlike paymongoCheckoutSessionId's reference_number (only
    // echoed back on checkout_session.* events, which PayMongo only ever
    // sends on success) or paymongoPaymentId (only known once a payment
    // has already been matched — no help for the very failure we're
    // trying to detect), this ID appears on every payment.paid AND
    // payment.failed event tied to this checkout, whether or not it
    // ever succeeds. It's the only reliable way to find and mark a
    // Payment "failed" when the checkout never completes.
    paymongoPaymentIntentId: { type: String, index: true },
    paymongoRefundId: { type: String },
    paymongoRefundStatus: { type: String },
    paymongoCheckoutUrl: { type: String },
    paymongoStatus: { type: String },
    paymentMethod: { type: String, enum: ["gcash", "card", "paymaya", "grab_pay", "dob", null], default: null },
    status: { type: String, enum: ["pending", "paid", "failed", "cancelled", "refunded"], default: "pending", index: true },
    paidAt: { type: Date, default: null },
    refundedAt: { type: Date, default: null },
    receiptUrl: { type: String },
    notes: { type: String },
    webhookEventIds: { type: [String], default: [] },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Payment", paymentSchema);