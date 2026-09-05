require("dotenv").config();

// Must be the first import in your app (after env vars are loaded), so
// Sentry can auto-instrument express/http/mongoose etc. as they're required
// below.
const Sentry = require("@sentry/node");

Sentry.init({
  dsn: process.env.SENTRY_DSN, // Reads from Render environment variables
  tracesSampleRate: 1.0,        // Capture 100% of transactions for performance monitoring
});

const express = require("express");
const http = require("http");
const cors = require("cors");
const helmet = require("helmet");
const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");

const connectDB = require("./config/db");
const { connectRedis } = require("./config/redis");
const startCronJobs = require("./cronJob");
const { checkPaymentConfig } = require("./utils/paymentConfigCheck");
const logger = require("./utils/logger");
const requestId = require("./middleware/requestId");
const apiMonitor = require("./middleware/apiMonitorMiddleware");
const maintenanceMode = require("./middleware/maintenanceMode");
const { globalLimiter } = require("./middleware/rateLimitMiddleware");
const { notFoundHandler, errorHandler } = require("./middleware/errorHandler");
const Message = require("./models/Message");
const User = require("./models/User");
const { notifyOnce } = require("./utils/notificationHelper");

const app = express();
const server = http.createServer(app);

// Safety net for errors outside Express's request/response cycle — cron
// jobs (cronJob.js), Socket.IO handlers, or any other async code not
// wrapped in a route handler. Those never reach errorHandler.js, and an
// uncaught rejection/exception there crashes the *entire* process by
// default in modern Node — taking down every connected user's session,
// not just failing one request. Concretely, this is what protects
// against ScheduledJobLog.create() in reminderJobs.js: it sits outside
// that function's own try/catch, so a single transient DB hiccup during
// the 7am cron run could otherwise have taken the whole API offline.
// Logging (and reporting to Sentry, already initialized above) instead
// of letting Node's default "crash" behavior run is what turns that
// from a full outage into a visible, investigable log line.
process.on("unhandledRejection", (err) => {
  logger.error({ err }, "Unhandled promise rejection");
  Sentry.captureException(err);
});
process.on("uncaughtException", (err) => {
  logger.error({ err }, "Uncaught exception");
  Sentry.captureException(err);
});

// ---- CORS ----
// Requests with no Origin header (server-to-server calls, the payment
// webhook) are allowed through unconditionally — this is intentional,
// not a bug, because the payment gateway's webhook call has no browser
// Origin at all. Don't "fix" this into breaking the webhook.
const devOrigins = ["http://localhost:3000", "http://localhost:5173", "http://127.0.0.1:3000"];
const allowedOrigins = (process.env.FRONTEND_URL || "").split(",").map((s) => s.trim()).filter(Boolean);

const corsOptions = {
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    if (process.env.NODE_ENV !== "production") {
      if (devOrigins.includes(origin) || allowedOrigins.includes(origin)) return callback(null, true);
      return callback(null, true); // permissive in dev
    }
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
};

app.set("trust proxy", 1);

// ---- Real middleware order (matches the source server.js exactly) ----
app.use(cors(corsOptions));
app.use(
  express.json({
    verify: (req, res, buf) => {
      // Needed for webhook signature verification (payment.paid, etc.) —
      // HMAC-ing a re-serialized req.body isn't guaranteed to reproduce
      // the exact bytes the sender signed; the raw buffer is.
      req.rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ extended: true }));
app.use(helmet());
app.use(requestId);

app.use("/api/", globalLimiter);
app.use("/api/", apiMonitor);
app.use(maintenanceMode);

app.get("/health", (req, res) => res.json({ success: true, status: "ok" }));
app.get("/", (req, res) => res.json({ success: true, message: "CarePaws API" }));

// ---- Resource routers ----
app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/roles", require("./routes/roleRoutes"));
app.use("/api/api-keys", require("./routes/apiKeyRoutes"));
app.use("/api/monitoring/api", require("./routes/apiMonitoringRoutes"));
app.use("/api/duplicates", require("./routes/duplicateRoutes"));
app.use("/api/adopter-profile", require("./routes/adopterProfileRoutes"));
app.use("/api/pets", require("./routes/petRoutes"));
app.use("/api/shelters", require("./routes/shelterRoutes"));
app.use("/api/shelter-care", require("./routes/shelterCareRoutes"));
app.use("/api/inventory", require("./routes/inventoryRoutes"));
app.use("/api/applications", require("./routes/applicationRoutes"));
app.use("/api/appointments", require("./routes/appointmentRoutes"));
app.use("/api/volunteers", require("./routes/volunteerRoutes"));
app.use("/api/payments", require("./routes/paymentRoutes"));
app.use("/api/notifications", require("./routes/notificationRoutes"));
app.use("/api/risk-assessments", require("./routes/riskAssessmentRoutes"));
app.use("/api/foster", require("./routes/fosterRoutes"));
app.use("/api/monitoring-reports", require("./routes/monitoringReportRoutes"));
app.use("/api/baby-book", require("./routes/babyBookRoutes"));
app.use("/api/medical", require("./routes/medicalRecordRoutes"));
app.use("/api/emergency-reports", require("./routes/emergencyReportRoutes"));
app.use("/api/interviews", require("./routes/interviewRoutes"));
app.use("/api/home-visits", require("./routes/homeVisitRoutes"));
app.use("/api/events", require("./routes/eventRoutes"));
app.use("/api/event-assignments", require("./routes/eventAssignmentRoutes"));
app.use("/api/feedback", require("./routes/feedbackRoutes"));
app.use("/api/announcements", require("./routes/announcementRoutes"));
app.use("/api/content", require("./routes/contentRoutes"));
app.use("/api/notes", require("./routes/noteRoutes"));
app.use("/api/email-templates", require("./routes/emailTemplateRoutes"));
app.use("/api/donations/goods", require("./routes/inKindDonationRoutes"));
app.use("/api/files", require("./routes/fileAssetRoutes"));
app.use("/api/documents", require("./routes/userDocumentRoutes"));
app.use("/api/scheduled-jobs", require("./routes/scheduledJobRoutes"));
app.use("/api/audit-logs", require("./routes/auditLogRoutes"));
app.use("/api/settings", require("./routes/settingsRoutes"));
app.use("/api/feature-flags", require("./routes/featureFlagRoutes"));
app.use("/api/errors", require("./routes/errorLogRoutes"));
app.use("/api/backups", require("./routes/backupRoutes"));
app.use("/api/migrations", require("./routes/migrationRoutes"));
// Generic archive API is intentionally NOT mounted — it allowed
// selecting an arbitrary Mongoose model via a URL param
// (mongoose.models[:collection]), has no caller anywhere in
// lykasAdmin/lykasUser, and isn't part of the manuscript's functional
// scope. See the top of routes/archiveRoutes.js for the full writeup
// and the conditions for safely re-enabling it.
// app.use("/api/archive", require("./routes/archiveRoutes"));
app.use("/api/dashboard", require("./routes/dashboardRoutes"));
app.use("/api/analytics", require("./routes/analyticsRoutes"));
app.use("/api/reports", require("./routes/reportsRoutes"));
app.use("/api/system", require("./routes/systemRoutes"));
const messageRoutes = require("./routes/messageRoutes");
app.use("/api/messages", messageRoutes);
app.use("/api/chat-sessions", messageRoutes.chatSessionsRouter);
// Additional resource routers (§5.3) are added phase by phase — see the
// Phase 1 manifest in the chat response for what's still pending.

app.use(notFoundHandler);
app.use(errorHandler);

// ---- Socket.io ----
const io = new Server(server, {
  cors: { origin: allowedOrigins.length ? allowedOrigins : true, credentials: true },
});

io.use((socket, next) => {
  const token =
    socket.handshake.auth?.token ||
    (socket.handshake.headers?.authorization || "").replace("Bearer ", "");

  if (!token) return next(new Error("Not authenticated"));

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    socket.userId = payload.id;
    socket.userRole = payload.role;
    next();
  } catch {
    next(new Error("Invalid or expired token"));
  }
});

io.on("connection", (socket) => {
  const isStaff = ["staff", "admin", "super_admin"].includes(socket.userRole);

  // Non-staff auto-join their own private room; staff must explicitly
  // emit joinAdmin (e.g. when the admin chat console mounts) — matches
  // the real source behavior rather than auto-joining staff on connect.
  if (!isStaff) {
    socket.join(socket.userId);
  }

  socket.on("joinAdmin", () => {
    if (isStaff) socket.join("admin_room");
  });

  socket.on("sendMessage", async ({ userId, text, image }, acknowledge) => {
    try {
      if (!userId || (!String(text || "").trim() && !image)) {
        const error = { success: false, message: "A message or image is required" };
        if (typeof acknowledge === "function") acknowledge(error);
        return;
      }

      // sender is derived server-side — never trust a client-supplied value
      const sender = socket.userId === userId ? "user" : "shelter";

      const message = await Message.create({ userId, sender, text: text?.trim(), image, isRead: false });

      // Persist a notification for the other side of the conversation.
      // The message itself remains the source of truth for chat history.
      if (sender === "shelter") {
        await notifyOnce({
          recipient: userId,
          type: "CHAT_MESSAGE",
          title: "New chat message",
          message: text ? String(text).slice(0, 160) : "You received a new message from CarePaws.",
          refModel: null,
          refId: null,
          dedupeKey: `chat-message:${message._id}:user`,
        });
      } else {
        const staffUsers = await User.find({ role: { $in: ["staff", "admin", "super_admin"] }, isDeleted: { $ne: true } }).select("_id");
        await Promise.all(staffUsers.map((staff) => notifyOnce({
          recipient: staff._id,
          type: "CHAT_MESSAGE",
          title: "New chat message",
          message: text ? String(text).slice(0, 160) : "A user sent a new chat message.",
          refModel: null,
          refId: null,
          dedupeKey: `chat-message:${message._id}:staff:${staff._id}`,
        })));
      }

      io.to(userId).to("admin_room").emit("receiveMessage", message);
      if (typeof acknowledge === "function") acknowledge({ success: true, data: message });
    } catch (err) {
      logger.error({ err }, "Failed to persist/emit chat message");
      if (typeof acknowledge === "function") acknowledge({ success: false, message: "Failed to send message" });
    }
  });

  socket.on("disconnect", () => {
    logger.debug({ userId: socket.userId }, "Socket disconnected");
  });
});

const PORT = process.env.PORT || 5000;

async function start() {
  try {
    const paymentConfigWarning = checkPaymentConfig();
    if (paymentConfigWarning) logger.warn(paymentConfigWarning);

    await connectDB();
    await connectRedis();
    startCronJobs();

    server.listen(PORT, () => {
      logger.info(`CarePaws API listening on port ${PORT} (${process.env.NODE_ENV || "development"})`);
    });
  } catch (err) {
    logger.fatal({ err }, "Failed to start server");
    process.exit(1);
  }
}

if (require.main === module) {
  start();
}

module.exports = { app, server, io };
