process.env.JWT_SECRET = "test_jwt_secret_at_least_32_characters_long";
process.env.NODE_ENV = "test";
jest.mock("../../src/middleware/rateLimitMiddleware", () => {
  const pass = (req, res, next) => next();
  return { globalLimiter: pass, loginLimiter: pass, registerLimiter: pass, passwordResetLimiter: pass, resendVerificationLimiter: pass, resetLinkLimiter: pass, webhookLimiter: pass };
});
jest.mock("../../src/utils/visitTracker", () => ({ recordVisit: () => {} }));
jest.mock("../../src/utils/notificationHelper", () => ({ notifyOnce: async () => {}, notify: async () => {} }));
const request = require("supertest");
const { io: ioc } = require("socket.io-client");
const { app, server } = require("../../src/server");
const jwt = require("jsonwebtoken");
const TokenBlacklist = require("../../src/models/TokenBlacklist");
const User = require("../../src/models/User");
const Interview = require("../../src/models/Interview");
const HomeVisit = require("../../src/models/HomeVisit");
const MonitoringReport = require("../../src/models/MonitoringReport");
const Volunteer = require("../../src/models/Volunteer");
const Message = require("../../src/models/Message");
const { EventVolunteerAssignment } = require("../../src/models/Event");

const OWNER = "64b000000000000000000001", STRANGER = "64b000000000000000000002", STAFFID = "64b000000000000000000003";
const users = {
  owner: { _id: OWNER, role: "user", status: "active", isDeleted: false },
  stranger: { _id: STRANGER, role: "user", status: "active", isDeleted: false },
  staff: { _id: STAFFID, role: "staff", status: "active", isDeleted: false },
};
const tok = (u) => jwt.sign({ id: u._id, role: u.role }, process.env.JWT_SECRET, { expiresIn: "15m" });
const auth = (u) => ({ Authorization: `Bearer ${tok(u)}` });
// Mocked-DB tests: no MongoDB needed. Covers the access-control fixes for
// interview/home-visit/monitoring-report GET /:id, event-assignment confirm,
// and the socket sendMessage sender check.
const doc = (extra) => {
  const d = { ...extra };
  d.toObject = () => JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(d).filter(([k]) => typeof d[k] !== "function"))));
  return d;
};
const chain = (v) => ({ populate: () => Promise.resolve(v) });

beforeEach(() => {
  jest.spyOn(require("../../src/models/ApiLog"), "create").mockResolvedValue({});
  jest.spyOn(TokenBlacklist, "findOne").mockResolvedValue(null);
  jest.spyOn(User, "findById").mockImplementation(async (id) => Object.values(users).find((u) => u._id === id) || null);
});
afterEach(() => jest.restoreAllMocks());

describe("GET /:id ownership (interview, home visit, monitoring report)", () => {
  const cases = [
    ["interview", "/api/interviews/abc", () => jest.spyOn(Interview, "findById").mockReturnValue(chain(doc({ _id: "abc", applicant: { _id: OWNER }, application: { internalNotes: ["secret"] } })))],
    ["home visit", "/api/home-visits/abc", () => jest.spyOn(HomeVisit, "findById").mockReturnValue(chain(doc({ _id: "abc", applicant: { _id: OWNER }, application: { internalNotes: ["secret"] } })))],
    ["monitoring report", "/api/monitoring-reports/abc", () => jest.spyOn(MonitoringReport, "findById").mockReturnValue(chain(doc({ _id: "abc", submittedBy: { _id: OWNER }, application: { internalNotes: ["secret"] } })))],
  ];
  for (const [name, url, setup] of cases) {
    it(`${name}: stranger gets 403`, async () => { setup(); const r = await request(app).get(url).set(auth(users.stranger)); expect(r.status).toBe(403); });
    it(`${name}: owner gets 200 without staff-only internalNotes`, async () => {
      setup(); const r = await request(app).get(url).set(auth(users.owner));
      expect(r.status).toBe(200); expect(r.body.data._id).toBe("abc"); expect(r.body.data.application.internalNotes).toBeUndefined();
    });
    it(`${name}: staff gets 200 and still sees internalNotes`, async () => {
      setup(); const r = await request(app).get(url).set(auth(users.staff));
      expect(r.status).toBe(200); expect(r.body.data.application.internalNotes).toEqual(["secret"]);
    });
  }
});

describe("PUT /api/event-assignments/:id/confirm", () => {
  const mk = () => { const a = { _id: "as1", volunteer: "vol-1", status: "assigned", save: jest.fn(async function () { return this; }) }; jest.spyOn(EventVolunteerAssignment, "findById").mockResolvedValue(a); return a; };
  it("403 for a different volunteer", async () => {
    const a = mk(); jest.spyOn(Volunteer, "findOne").mockReturnValue({ select: async () => ({ _id: "vol-2" }) });
    const r = await request(app).put("/api/event-assignments/as1/confirm").set(auth(users.stranger));
    expect(r.status).toBe(403); expect(a.save).not.toHaveBeenCalled();
  });
  it("403 for a user with no volunteer profile", async () => {
    const a = mk(); jest.spyOn(Volunteer, "findOne").mockReturnValue({ select: async () => null });
    const r = await request(app).put("/api/event-assignments/as1/confirm").set(auth(users.stranger));
    expect(r.status).toBe(403); expect(a.save).not.toHaveBeenCalled();
  });
  it("200 for the assigned volunteer", async () => {
    const a = mk(); jest.spyOn(Volunteer, "findOne").mockReturnValue({ select: async () => ({ _id: "vol-1" }) });
    const r = await request(app).put("/api/event-assignments/as1/confirm").set(auth(users.owner));
    expect(r.status).toBe(200); expect(a.status).toBe("confirmed");
  });
  it("200 for staff", async () => {
    const a = mk(); const r = await request(app).put("/api/event-assignments/as1/confirm").set(auth(users.staff));
    expect(r.status).toBe(200); expect(a.status).toBe("confirmed");
  });
});

describe("socket sendMessage sender spoofing", () => {
  let port;
  beforeAll((done) => { server.listen(0, () => { port = server.address().port; done(); }); });
  afterAll((done) => { server.close(done); });
  const send = (u, payload) => new Promise((resolve, reject) => {
    const c = ioc(`http://localhost:${port}`, { auth: { token: tok(u) }, transports: ["websocket"] });
    c.on("connect_error", reject);
    c.on("connect", () => c.emit("sendMessage", payload, (ack) => { c.close(); resolve(ack); }));
  });
  beforeEach(() => {
    jest.spyOn(Message, "create").mockImplementation(async (d) => ({ _id: "m1", ...d }));
    jest.spyOn(User, "find").mockReturnValue({ select: async () => [] });
  });
  it("normal user cannot post into another user's chat", async () => {
    const ack = await send(users.stranger, { userId: OWNER, text: "I am the shelter" });
    expect(ack.success).toBe(false); expect(Message.create).not.toHaveBeenCalled();
  });
  it("normal user can post into their own chat as 'user'", async () => {
    const ack = await send(users.owner, { userId: OWNER, text: "hi" });
    expect(ack.success).toBe(true); expect(ack.data.sender).toBe("user");
  });
  it("staff can reply into a user's chat as 'shelter'", async () => {
    const ack = await send(users.staff, { userId: OWNER, text: "hello from shelter" });
    expect(ack.success).toBe(true); expect(ack.data.sender).toBe("shelter");
  });
});
