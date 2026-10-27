const { z } = require("zod");
const { NOTIFICATION_TYPES } = require("../models/Notification");

const sendNotificationSchema = z
  .object({
    recipientIds: z.array(z.string()).min(1),
    type: z.enum(NOTIFICATION_TYPES),
    title: z.string().min(1).max(200),
    message: z.string().min(1).max(1000),
    refModel: z.enum(["Application", "Interview", "HomeVisit", "AdoptionPickup", "Foster", "MonitoringReport", "Event", "Pet", "Payment", "InKindDonation"]).optional(),
    refId: z.string().optional(),
  })
  .strict();

module.exports = { sendNotificationSchema };
