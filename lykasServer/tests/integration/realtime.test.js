// NOTE: needs the in-memory MongoDB from tests/setup.js like the other
// integration tests. Verifies the real Mongoose hooks (not just the helper)
// reach Socket.IO.
const mongoose = require("mongoose");

jest.mock("../../src/middleware/rateLimitMiddleware", () => ({
  globalLimiter: (req, res, next) => next(),
  loginLimiter: (req, res, next) => next(),
  registerLimiter: (req, res, next) => next(),
  passwordResetLimiter: (req, res, next) => next(),
  resendVerificationLimiter: (req, res, next) => next(),
  resetLinkLimiter: (req, res, next) => next(),
  webhookLimiter: (req, res, next) => next(),
}));

require("../../src/server");
const realtime = require("../../src/utils/realtime");
const Notification = require("../../src/models/Notification");

function fakeIo() {
  const calls = [];
  const chain = (targets, excepts = []) => ({
    except: (room) => chain(targets, [...excepts, room]),
    emit: (event, payload) => calls.push({ targets, excepts, event, payload }),
  });
  return { calls, to: (t) => chain(Array.isArray(t) ? t : [t]), emit: (event, payload) => calls.push({ targets: "ALL", event, payload }) };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

describe("realtime change feed (real Mongoose hooks)", () => {
  it("tells staff and the owning user when a notification is created, updated and bulk-updated", async () => {
    const io = fakeIo();
    realtime.setIo(io);
    const recipient = new mongoose.Types.ObjectId();

    const note = await Notification.create({ recipient, type: "CHAT_MESSAGE", title: "Hi", message: "Hello" });
    await wait(400);
    expect(io.calls.some((c) => c.targets[0] === realtime.STAFF_ROOM && c.payload.resource === "Notification")).toBe(true);
    expect(io.calls.some((c) => c.targets.includes(String(recipient)) && c.payload.ids === undefined)).toBe(true);

    io.calls.length = 0;
    await Notification.findByIdAndUpdate(note._id, { isRead: true });
    await Notification.updateMany({ recipient }, { isRead: true });
    await wait(400);
    expect(io.calls.length).toBeGreaterThan(0);
    expect(io.calls.every((c) => c.event === "data:changed")).toBe(true);
  });
});
