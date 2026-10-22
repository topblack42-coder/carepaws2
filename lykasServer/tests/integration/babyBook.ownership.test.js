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
const Pet = require("../../src/models/Pet");

async function registerAndLogin(email, role = "user") {
  const res = await request(app)
    .post("/api/auth/register")
    .send({ displayName: "Test " + role, email, password: "password123" });

  if (role !== "user") {
    await User.findOneAndUpdate({ email }, { role });
    // Log in again to get a token carrying the updated role.
    const loginRes = await request(app).post("/api/auth/login").send({ email, password: "password123" });
    return { token: loginRes.body.data.accessToken, user: loginRes.body.data.user };
  }

  return { token: res.body.data.accessToken, user: res.body.data.user };
}

describe("Baby book: CRUD and ownership", () => {
  let owner, stranger, staff, pet;

  beforeEach(async () => {
    owner = await registerAndLogin("owner@example.com", "user");
    stranger = await registerAndLogin("stranger@example.com", "user");
    staff = await registerAndLogin("staff@example.com", "staff");

    pet = await Pet.create({ name: "Milo", species: "Dog", status: "Adopted", owner: owner.user.id });
  });

  it("lets the pet's owner create, list, update and delete their own entries, and it survives a reload", async () => {
    const createRes = await request(app)
      .post("/api/baby-book")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ pet: pet._id.toString(), title: "First walk", category: "Milestone" });
    expect(createRes.status).toBe(201);
    const entryId = createRes.body.data._id;

    const listRes = await request(app).get(`/api/baby-book/${pet._id}`).set("Authorization", `Bearer ${owner.token}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.data).toHaveLength(1);
    expect(listRes.body.data[0]._id).toBe(entryId);

    const updateRes = await request(app)
      .put(`/api/baby-book/entry/${entryId}`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ title: "First walk in the park" });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.data.title).toBe("First walk in the park");

    const deleteRes = await request(app)
      .delete(`/api/baby-book/entry/${entryId}`)
      .set("Authorization", `Bearer ${owner.token}`);
    expect(deleteRes.status).toBe(200);

    const afterDelete = await request(app).get(`/api/baby-book/${pet._id}`).set("Authorization", `Bearer ${owner.token}`);
    expect(afterDelete.body.data).toHaveLength(0);
  });

  it("blocks a non-owner from creating an entry on someone else's pet", async () => {
    const res = await request(app)
      .post("/api/baby-book")
      .set("Authorization", `Bearer ${stranger.token}`)
      .send({ pet: pet._id.toString(), title: "Sneaky entry", category: "General" });
    expect(res.status).toBe(403);
  });

  it("blocks a non-owner from reading someone else's pet's baby book", async () => {
    await request(app)
      .post("/api/baby-book")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ pet: pet._id.toString(), title: "Private moment", category: "Funny Moment" });

    const res = await request(app).get(`/api/baby-book/${pet._id}`).set("Authorization", `Bearer ${stranger.token}`);
    expect(res.status).toBe(404);
  });

  it("lets staff read any pet's baby book for shelter/foster oversight", async () => {
    await request(app)
      .post("/api/baby-book")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ pet: pet._id.toString(), title: "Vet checkup", category: "Health" });

    const res = await request(app).get(`/api/baby-book/${pet._id}`).set("Authorization", `Bearer ${staff.token}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it("rejects creating an entry for a pet id that doesn't exist", async () => {
    const fakeId = "64b7f0f0f0f0f0f0f0f0f0f0";
    const res = await request(app)
      .post("/api/baby-book")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ pet: fakeId, title: "Ghost pet", category: "General" });
    expect(res.status).toBe(404);
  });

  it("does not allow an owner to reassign an entry to another pet", async () => {
    const otherPet = await Pet.create({ name: "Other Pet", species: "Cat", status: "Adopted", owner: owner.user.id });
    const createRes = await request(app)
      .post("/api/baby-book")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ pet: pet._id.toString(), title: "First walk", category: "Milestone" });
    const entryId = createRes.body.data._id;

    const updateRes = await request(app)
      .put(`/api/baby-book/entry/${entryId}`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ pet: otherPet._id.toString(), title: "Moved" });

    expect(updateRes.status).toBe(400);
    const entry = await require("../../src/models/BabyBook").findById(entryId);
    expect(entry.pet.toString()).toBe(pet._id.toString());
  });

  it("prevents one owner's entry from being edited or deleted by another user", async () => {
    const createRes = await request(app)
      .post("/api/baby-book")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ pet: pet._id.toString(), title: "First walk", category: "Milestone" });
    const entryId = createRes.body.data._id;

    const updateRes = await request(app)
      .put(`/api/baby-book/entry/${entryId}`)
      .set("Authorization", `Bearer ${stranger.token}`)
      .send({ title: "Hijacked" });
    expect(updateRes.status).toBe(404);

    const deleteRes = await request(app)
      .delete(`/api/baby-book/entry/${entryId}`)
      .set("Authorization", `Bearer ${stranger.token}`);
    expect(deleteRes.status).toBe(404);
  });

  it("lets the owner clear an entry's details by updating content to an empty string", async () => {
    const createRes = await request(app)
      .post("/api/baby-book")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ pet: pet._id.toString(), title: "First walk", content: "Loved the park", category: "Milestone" });
    const entryId = createRes.body.data._id;
    expect(createRes.body.data.content).toBe("Loved the park");

    const updateRes = await request(app)
      .put(`/api/baby-book/entry/${entryId}`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ content: "" });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.data.content).toBe("");

    const stored = await require("../../src/models/BabyBook").findById(entryId);
    expect(stored.content).toBe("");
    expect(stored.title).toBe("First walk");
  });

  it("clears details when content is sent as an empty multipart field (mobile FormData)", async () => {
    const createRes = await request(app)
      .post("/api/baby-book")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ pet: pet._id.toString(), title: "Vet visit", content: "All good", category: "Health" });
    const entryId = createRes.body.data._id;

    const updateRes = await request(app)
      .put(`/api/baby-book/entry/${entryId}`)
      .set("Authorization", `Bearer ${owner.token}`)
      .field("title", "Vet visit")
      .field("content", "")
      .field("category", "Health");
    expect(updateRes.status).toBe(200);

    const stored = await require("../../src/models/BabyBook").findById(entryId);
    expect(stored.content).toBe("");
  });
});
