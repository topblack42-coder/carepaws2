const request = require("supertest");

jest.mock("../../src/middleware/rateLimitMiddleware", () => ({
  globalLimiter: (req, res, next) => next(),
  loginLimiter: (req, res, next) => next(),
  registerLimiter: (req, res, next) => next(),
  passwordResetLimiter: (req, res, next) => next(),
  resendVerificationLimiter: (req, res, next) => next(),
  webhookLimiter: (req, res, next) => next(),
}));

const { app } = require("../../src/server");
const User = require("../../src/models/User");
const Appointment = require("../../src/models/Appointment");
const { Event, EventRegistration } = require("../../src/models/Event");
const Volunteer = require("../../src/models/Volunteer");

async function registerAndLogin(email, role = "user") {
  const response = await request(app)
    .post("/api/auth/register")
    .send({ displayName: "Workflow Test", email, password: "password123" });

  // These suites exercise actions gated by requireVerifiedEmail; verification itself is covered in emailVerification.test.js.
  await User.findOneAndUpdate({ email }, { emailVerified: true });

  if (role === "user") return { token: response.body.data.accessToken, user: response.body.data.user };

  await User.findOneAndUpdate({ email }, { role });
  const login = await request(app).post("/api/auth/login").send({ email, password: "password123" });
  return { token: login.body.data.accessToken, user: login.body.data.user };
}

describe("Volunteer and event workflows", () => {
  it("rejects every real shift overlap but allows adjacent shifts", async () => {
    const volunteer = await registerAndLogin("shift-user@example.com");

    const first = await Appointment.create({
      title: "Morning shift",
      date: new Date("2030-01-10T08:00:00.000Z"),
      durationHours: 2,
      capacity: 1,
      registrations: [{ user: volunteer.user.id, phone: "0917000000" }],
      status: "Full",
    });

    const overlapping = await Appointment.create({
      title: "Contained shift",
      date: new Date("2030-01-10T08:30:00.000Z"),
      durationHours: 1,
      capacity: 1,
      status: "Open",
    });

    const overlapResponse = await request(app)
      .post(`/api/appointments/${overlapping._id}/enroll`)
      .set("Authorization", `Bearer ${volunteer.token}`)
      .send({ phone: "0917000000" });

    expect(overlapResponse.status).toBe(409);
    expect(overlapResponse.body.code).toBe("SHIFT_CONFLICT");

    const adjacent = await Appointment.create({
      title: "Adjacent shift",
      date: new Date("2030-01-10T10:00:00.000Z"),
      durationHours: 2,
      capacity: 1,
      status: "Open",
    });

    const adjacentResponse = await request(app)
      .post(`/api/appointments/${adjacent._id}/enroll`)
      .set("Authorization", `Bearer ${volunteer.token}`)
      .send({ phone: "0917000000" });

    expect(adjacentResponse.status).toBe(201);
    expect(first.registrations).toHaveLength(1);
  });

  it("enforces event capacity and keeps attendee count correct after cancellation", async () => {
    const admin = await registerAndLogin("event-admin@example.com", "admin");
    const one = await registerAndLogin("event-one@example.com");
    const two = await registerAndLogin("event-two@example.com");

    const event = await Event.create({
      title: "Capacity Event",
      category: "Community",
      date: new Date("2030-01-10T08:00:00.000Z"),
      maxAttendees: 1,
      createdBy: admin.user.id,
    });

    const [first, second] = await Promise.all([
      request(app).post(`/api/events/${event._id}/register`).set("Authorization", `Bearer ${one.token}`),
      request(app).post(`/api/events/${event._id}/register`).set("Authorization", `Bearer ${two.token}`),
    ]);

    expect([first.status, second.status].sort()).toEqual([201, 409]);

    const stored = await Event.findById(event._id);
    expect(stored.currentAttendees).toBe(1);
    expect(await EventRegistration.countDocuments({ event: event._id, status: "registered" })).toBe(1);

    const winner = first.status === 201 ? one : two;
    const loser = first.status === 201 ? two : one;

    const duplicate = await request(app)
      .post(`/api/events/${event._id}/register`)
      .set("Authorization", `Bearer ${winner.token}`);
    expect(duplicate.status).toBe(409);

    const cancelled = await request(app)
      .delete(`/api/events/${event._id}/register`)
      .set("Authorization", `Bearer ${winner.token}`);
    expect(cancelled.status).toBe(200);

    const afterCancel = await Event.findById(event._id);
    expect(afterCancel.currentAttendees).toBe(0);

    const retry = await request(app)
      .post(`/api/events/${event._id}/register`)
      .set("Authorization", `Bearer ${loser.token}`);
    expect(retry.status).toBe(201);
    expect((await Event.findById(event._id)).currentAttendees).toBe(1);
  });

  it("persists volunteer skills, availability, status and review notes", async () => {
    const user = await registerAndLogin("volunteer-profile@example.com");
    const created = await request(app)
      .post("/api/volunteers/register")
      .set("Authorization", `Bearer ${user.token}`)
      .send({
        phone: "0917000000",
        address: "Shelter address",
        skills: ["animal care", "event setup"],
        availability: ["Weekends"],
      });

    expect(created.status).toBe(201);

    const profile = await request(app)
      .put("/api/volunteers/me")
      .set("Authorization", `Bearer ${user.token}`)
      .send({
        phone: "0917111111",
        address: "Updated address",
        skills: ["animal care", "photography"],
        availability: ["Weekday mornings", "Weekends"],
      });

    expect(profile.status).toBe(200);
    expect(profile.body.data.skills).toEqual(["animal care", "photography"]);
    expect(profile.body.data.availability).toEqual(["Weekday mornings", "Weekends"]);

    const admin = await registerAndLogin("volunteer-reviewer@example.com", "admin");
    const review = await request(app)
      .put(`/api/volunteers/${created.body.data._id}/status`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ status: "approved", notes: "Approved for volunteer work" });

    expect(review.status).toBe(200);
    expect(review.body.data.status).toBe("approved");
    expect(review.body.data.notes).toBe("Approved for volunteer work");
  });
});
