const request = require("supertest");

// Keep the size limit tiny so the oversize case doesn't need a huge buffer.
// Must be set before the app (and its upload middleware) is loaded.
process.env.PET_VIDEO_MAX_SIZE_MB = "1";
process.env.PET_VIDEO_MAX_DURATION_SECONDS = "60";

jest.mock("../../src/middleware/rateLimitMiddleware", () => ({
  globalLimiter: (req, res, next) => next(),
  loginLimiter: (req, res, next) => next(),
  registerLimiter: (req, res, next) => next(),
  passwordResetLimiter: (req, res, next) => next(),
  resendVerificationLimiter: (req, res, next) => next(),
  resetLinkLimiter: (req, res, next) => next(),
  webhookLimiter: (req, res, next) => next(),
}));

// Cloudinary is never contacted: uploads and deletes are simulated.
const mockCloudinary = { uploader: { upload_stream: jest.fn(), destroy: jest.fn() } };
jest.mock("../../src/config/cloudinary", () => mockCloudinary);

const { app } = require("../../src/server");
const User = require("../../src/models/User");
const Pet = require("../../src/models/Pet");

async function registerAndLogin(email, role = "user") {
  const res = await request(app)
    .post("/api/auth/register")
    .send({ displayName: "Test " + role, email, password: "password123" });

  // These suites exercise actions gated by requireVerifiedEmail; verification itself is covered in emailVerification.test.js.
  await User.findOneAndUpdate({ email }, { emailVerified: true });

  if (role !== "user") {
    await User.findOneAndUpdate({ email }, { role });
    const loginRes = await request(app).post("/api/auth/login").send({ email, password: "password123" });
    return { token: loginRes.body.data.accessToken, user: loginRes.body.data.user };
  }
  return { token: res.body.data.accessToken, user: res.body.data.user };
}

// A tiny buffer that starts like a real MP4 ("....ftypmp42").
function fakeMp4(extraBytes = 2048) {
  return Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypmp42"), Buffer.alloc(extraBytes, 1)]);
}

let uploadCounter = 0;
function cloudinaryReturns(overrides = {}) {
  mockCloudinary.uploader.upload_stream.mockImplementation((opts, cb) => ({
    end: () => {
      if (opts.resource_type === "video") {
        uploadCounter += 1;
        const id = `carepaws/pet-videos/vid${uploadCounter}`;
        cb(null, {
          public_id: id,
          secure_url: `https://res.cloudinary.com/demo/video/upload/v1/${id}.mp4`,
          duration: 12.4,
          bytes: 2060,
          width: 720,
          height: 1280,
          video: { codec: "h264" },
          ...overrides,
        });
      } else {
        cb(null, { secure_url: "https://res.cloudinary.com/demo/image/upload/v1/pet.jpg" });
      }
    },
  }));
}

function cloudinaryFails(error) {
  mockCloudinary.uploader.upload_stream.mockImplementation((opts, cb) => ({ end: () => cb(error) }));
}

function videoUploadCalls() {
  return mockCloudinary.uploader.upload_stream.mock.calls.filter(([opts]) => opts.resource_type === "video");
}

const destroyedIds = () => mockCloudinary.uploader.destroy.mock.calls.map(([id]) => id);

describe("Optional pet introduction video", () => {
  let staff, adopter;

  beforeEach(async () => {
    uploadCounter = 0;
    mockCloudinary.uploader.upload_stream.mockReset();
    mockCloudinary.uploader.destroy.mockReset().mockResolvedValue({ result: "ok" });
    cloudinaryReturns();
    staff = await registerAndLogin("staff@example.com", "staff");
    adopter = await registerAndLogin("adopter@example.com", "user");
  });

  afterEach(() => jest.restoreAllMocks());

  const auth = (who) => ({ Authorization: `Bearer ${who.token}` });

  function createPetRequest(extra) {
    const req = request(app).post("/api/pets").set(auth(staff)).field("name", "Bella").field("species", "Dog");
    return extra ? extra(req) : req;
  }

  async function createPetWithVideo() {
    const res = await createPetRequest((r) => r.attach("video", fakeMp4(), { filename: "bella.mp4", contentType: "video/mp4" }));
    expect(res.status).toBe(201);
    return res.body.data;
  }

  describe("creating", () => {
    it("creates a pet without a video and returns video: null", async () => {
      const res = await createPetRequest();
      expect(res.status).toBe(201);
      expect(res.body.data.video).toBeNull();
      expect(videoUploadCalls()).toHaveLength(0);
    });

    it("creates a pet with a valid video and stores only the reference + metadata", async () => {
      const res = await createPetRequest((r) => r.attach("video", fakeMp4(), { filename: "bella.mp4", contentType: "video/mp4" }));
      expect(res.status).toBe(201);
      expect(res.body.data.video).toMatchObject({
        url: expect.stringMatching(/^https:\/\/res\.cloudinary\.com\/.+\.mp4$/),
        thumbnailUrl: expect.stringMatching(/\.jpg$/),
        duration: 12.4,
        mimeType: "video/mp4",
        width: 720,
        height: 1280,
      });
      expect(videoUploadCalls()).toHaveLength(1);

      const stored = await Pet.findById(res.body.data._id);
      expect(stored.video.publicId).toMatch(/^carepaws\/pet-videos\//);
    });

    it("creates a pet with both a photo and a video", async () => {
      const res = await createPetRequest((r) =>
        r
          .attach("image", Buffer.from("fake-image"), { filename: "bella.png", contentType: "image/png" })
          .attach("video", fakeMp4(), { filename: "bella.mp4", contentType: "video/mp4" })
      );
      expect(res.status).toBe(201);
      expect(res.body.data.imageUrl).toContain("/image/upload/");
      expect(res.body.data.video.url).toContain("/video/upload/");
    });

    it("deletes the uploaded video if the pet itself can't be created", async () => {
      jest.spyOn(Pet, "create").mockRejectedValueOnce(new Error("db down"));
      const res = await createPetRequest((r) => r.attach("video", fakeMp4(), { filename: "a.mp4", contentType: "video/mp4" }));
      expect(res.status).toBe(500);
      expect(destroyedIds()).toEqual(["carepaws/pet-videos/vid1"]);
      expect(await Pet.countDocuments()).toBe(0);
    });
  });

  describe("editing", () => {
    it("adds a video later to an existing pet without creating a duplicate", async () => {
      const created = (await createPetRequest()).body.data;

      const res = await request(app)
        .put(`/api/pets/${created._id}`)
        .set(auth(staff))
        .attach("video", fakeMp4(), { filename: "late.mp4", contentType: "video/mp4" });

      expect(res.status).toBe(200);
      expect(res.body.data._id).toBe(created._id);
      expect(res.body.data.video.url).toContain("/video/upload/");
      expect(await Pet.countDocuments()).toBe(1);
    });

    it("does NOT clear the video when ordinary fields are edited", async () => {
      const pet = await createPetWithVideo();

      const res = await request(app).put(`/api/pets/${pet._id}`).set(auth(staff)).field("name", "Bella II").field("description", "Sweet");
      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe("Bella II");
      expect(res.body.data.video.publicId).toBe(pet.video.publicId);
      expect(mockCloudinary.uploader.destroy).not.toHaveBeenCalled();
    });

    it("replaces a video, pointing at the new one and deleting the old file afterwards", async () => {
      const pet = await createPetWithVideo();

      const res = await request(app)
        .put(`/api/pets/${pet._id}`)
        .set(auth(staff))
        .attach("video", fakeMp4(), { filename: "new.mp4", contentType: "video/mp4" });

      expect(res.status).toBe(200);
      expect(res.body.data.video.publicId).not.toBe(pet.video.publicId);
      expect(destroyedIds()).toEqual([pet.video.publicId]);
      expect(mockCloudinary.uploader.destroy).toHaveBeenCalledWith(pet.video.publicId, expect.objectContaining({ resource_type: "video" }));
    });

    it("keeps the old video when the replacement upload fails", async () => {
      const pet = await createPetWithVideo();
      cloudinaryFails(Object.assign(new Error("boom"), { http_code: 500 }));

      const res = await request(app)
        .put(`/api/pets/${pet._id}`)
        .set(auth(staff))
        .attach("video", fakeMp4(), { filename: "new.mp4", contentType: "video/mp4" });

      expect(res.status).toBe(502);
      expect(res.body.message).toMatch(/temporarily unavailable/i);
      const stored = await Pet.findById(pet._id);
      expect(stored.video.publicId).toBe(pet.video.publicId);
      expect(mockCloudinary.uploader.destroy).not.toHaveBeenCalled();
    });

    it("keeps the old video and removes the new upload when saving the pet fails", async () => {
      const pet = await createPetWithVideo();
      jest.spyOn(Pet.prototype, "save").mockRejectedValueOnce(new Error("db down"));

      const res = await request(app)
        .put(`/api/pets/${pet._id}`)
        .set(auth(staff))
        .attach("video", fakeMp4(), { filename: "new.mp4", contentType: "video/mp4" });

      expect(res.status).toBe(500);
      expect(destroyedIds()).toEqual(["carepaws/pet-videos/vid2"]); // the NEW file, never the old one
      const stored = await Pet.findById(pet._id);
      expect(stored.video.publicId).toBe(pet.video.publicId);
    });

    it("does not delete a file that another pet still references", async () => {
      const pet = await createPetWithVideo();
      const other = await Pet.create({ name: "Twin", species: "Cat", video: pet.video });

      const res = await request(app)
        .put(`/api/pets/${pet._id}`)
        .set(auth(staff))
        .attach("video", fakeMp4(), { filename: "new.mp4", contentType: "video/mp4" });

      expect(res.status).toBe(200);
      expect(mockCloudinary.uploader.destroy).not.toHaveBeenCalled();
      expect((await Pet.findById(other._id)).video.publicId).toBe(pet.video.publicId);
    });
  });

  describe("removing", () => {
    it("removes the video only, leaving the pet, photo and other data intact", async () => {
      const created = await Pet.create({
        name: "Bella",
        species: "Dog",
        description: "Sweet girl",
        imageUrl: "https://res.cloudinary.com/demo/image/upload/v1/bella.jpg",
      });
      const withVideo = await request(app)
        .put(`/api/pets/${created._id}`)
        .set(auth(staff))
        .attach("video", fakeMp4(), { filename: "v.mp4", contentType: "video/mp4" });
      const publicId = withVideo.body.data.video.publicId;

      const res = await request(app).delete(`/api/pets/${created._id}/video`).set(auth(staff));

      expect(res.status).toBe(200);
      expect(res.body.data.video).toBeNull();
      expect(destroyedIds()).toEqual([publicId]);

      const stored = await Pet.findById(created._id);
      expect(stored.isDeleted).toBe(false);
      expect(stored.description).toBe("Sweet girl");
      expect(stored.imageUrl).toContain("bella.jpg");
      expect(stored.video).toBeNull();
    });

    it("is a harmless no-op for a pet that has no video", async () => {
      const pet = await Pet.create({ name: "Milo", species: "Cat" });
      const res = await request(app).delete(`/api/pets/${pet._id}/video`).set(auth(staff));
      expect(res.status).toBe(200);
      expect(res.body.data.video).toBeNull();
      expect(mockCloudinary.uploader.destroy).not.toHaveBeenCalled();
    });

    it("returns 404 for an unknown pet and 400 for a malformed id", async () => {
      const missing = await request(app).delete("/api/pets/507f1f77bcf86cd799439011/video").set(auth(staff));
      expect(missing.status).toBe(404);
      const bad = await request(app).delete("/api/pets/not-an-id/video").set(auth(staff));
      expect(bad.status).toBe(400);
    });
  });

  describe("validation", () => {
    const attachVideo = (buffer, contentType = "video/mp4", filename = "clip.mp4") =>
      createPetRequest((r) => r.attach("video", buffer, { filename, contentType }));

    it("rejects a file that claims to be MP4 but isn't (magic-byte check)", async () => {
      const res = await attachVideo(Buffer.from("this is definitely not a video, just text".repeat(10)));
      expect(res.status).toBe(415);
      expect(res.body.message).toMatch(/not a valid MP4/i);
      expect(videoUploadCalls()).toHaveLength(0);
      expect(await Pet.countDocuments()).toBe(0);
    });

    it("rejects an unsupported MIME type", async () => {
      const res = await attachVideo(fakeMp4(), "video/x-msvideo", "clip.avi");
      expect(res.status).toBe(415);
      expect(videoUploadCalls()).toHaveLength(0);
    });

    it("rejects a video over the size limit with 413", async () => {
      const res = await attachVideo(fakeMp4(1.2 * 1024 * 1024));
      expect(res.status).toBe(413);
      expect(res.body.message).toMatch(/1 MB or smaller/);
      expect(videoUploadCalls()).toHaveLength(0);
    });

    it("rejects a video longer than the limit and removes the stored file", async () => {
      cloudinaryReturns({ duration: 95 });
      const res = await attachVideo(fakeMp4());
      expect(res.status).toBe(422);
      expect(res.body.message).toMatch(/60 seconds or shorter/);
      expect(destroyedIds()).toEqual(["carepaws/pet-videos/vid1"]);
      expect(await Pet.countDocuments()).toBe(0);
    });

    it("rejects an unsupported codec and removes the stored file", async () => {
      cloudinaryReturns({ video: { codec: "hevc" } });
      const res = await attachVideo(fakeMp4());
      expect(res.status).toBe(422);
      expect(res.body.message).toMatch(/codec/i);
      expect(destroyedIds()).toEqual(["carepaws/pet-videos/vid1"]);
    });

    it("rejects a corrupted video that the storage provider can't process", async () => {
      cloudinaryFails(Object.assign(new Error("Invalid video file"), { http_code: 400 }));
      const res = await attachVideo(fakeMp4());
      expect(res.status).toBe(422);
      expect(res.body.message).toMatch(/corrupted|unsupported/i);
    });

    it("rejects an unexpected upload field", async () => {
      const res = await createPetRequest((r) => r.attach("clip", fakeMp4(), { filename: "a.mp4", contentType: "video/mp4" }));
      expect(res.status).toBe(400);
    });
  });

  describe("permissions", () => {
    it("blocks anonymous users and ordinary adopters from creating, replacing or removing videos", async () => {
      const pet = await Pet.create({ name: "Milo", species: "Cat" });
      const mp4 = { filename: "a.mp4", contentType: "video/mp4" };

      const anonCreate = await request(app).post("/api/pets").field("name", "X").field("species", "Dog").attach("video", fakeMp4(), mp4);
      expect(anonCreate.status).toBe(401);

      const adopterCreate = await request(app).post("/api/pets").set(auth(adopter)).field("name", "X").field("species", "Dog").attach("video", fakeMp4(), mp4);
      expect(adopterCreate.status).toBe(403);

      const adopterReplace = await request(app).put(`/api/pets/${pet._id}`).set(auth(adopter)).attach("video", fakeMp4(), mp4);
      expect(adopterReplace.status).toBe(403);

      const adopterRemove = await request(app).delete(`/api/pets/${pet._id}/video`).set(auth(adopter));
      expect(adopterRemove.status).toBe(403);

      const anonRemove = await request(app).delete(`/api/pets/${pet._id}/video`);
      expect(anonRemove.status).toBe(401);

      expect(videoUploadCalls()).toHaveLength(0);
    });
  });

  describe("backward compatibility", () => {
    it("serves legacy pets that were stored before the video field existed", async () => {
      const { insertedId } = await Pet.collection.insertOne({
        name: "Old Timer",
        species: "Dog",
        status: "Available",
        isDeleted: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const one = await request(app).get(`/api/pets/${insertedId}`);
      expect(one.status).toBe(200);
      expect(one.body.data.video).toBeNull();

      const list = await request(app).get("/api/pets");
      expect(list.status).toBe(200);
      expect(list.body.data.find((p) => p._id === String(insertedId)).video).toBeNull();

      const edit = await request(app).put(`/api/pets/${insertedId}`).set(auth(staff)).field("description", "Still works");
      expect(edit.status).toBe(200);
      expect(edit.body.data.description).toBe("Still works");
    });

    it("exposes the video on the public detail and list endpoints", async () => {
      const pet = await createPetWithVideo();
      const one = await request(app).get(`/api/pets/${pet._id}`);
      expect(one.body.data.video.url).toBe(pet.video.url);
      const list = await request(app).get("/api/pets");
      expect(list.body.data[0].video.url).toBe(pet.video.url);
    });

    it("lets an adopter apply for a pet with a video exactly as for any other pet", async () => {
      const pet = await createPetWithVideo();
      const res = await request(app)
        .post("/api/applications")
        .set(auth(adopter))
        .send({ pet: pet._id, phone: "0917000000", address: "123 Main St" });
      expect(res.status).toBe(201);
    });

    it("cleans up the video file when a pet is permanently deleted", async () => {
      const pet = await createPetWithVideo();
      const root = await registerAndLogin("root@example.com", "super_admin");
      const res = await request(app).delete(`/api/pets/${pet._id}/permanent`).set(auth(root));
      expect(res.status).toBe(200);
      expect(destroyedIds()).toEqual([pet.video.publicId]);
    });
  });
});
