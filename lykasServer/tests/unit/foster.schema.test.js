const { fosterEndSchema, fosterExtendSchema, returnRequestSchema } = require("../../src/validators/foster.schema");

const check = { notes: "Checked in person, healthy.", vetVerified: false };
const extend = { extensionDays: 14, reason: "Still recovering from surgery.", vetAgreed: true, fostererAgreed: true };

describe("fosterEndSchema", () => {
  it("accepts ADOPTED and RETURNED with a health check", () => {
    for (const outcome of ["ADOPTED", "RETURNED"]) expect(fosterEndSchema.safeParse({ outcome, finalHealthCheck: check }).success).toBe(true);
  });

  it("rejects EXTENDED and unknown outcomes", () => {
    for (const outcome of ["EXTENDED", "DONE", "returned", ""]) expect(fosterEndSchema.safeParse({ outcome, finalHealthCheck: check }).success).toBe(false);
  });

  it("requires a health check and a real exception reason", () => {
    expect(fosterEndSchema.safeParse({ outcome: "RETURNED" }).success).toBe(false);
    expect(fosterEndSchema.safeParse({ outcome: "RETURNED", finalHealthCheck: { notes: "ok", vetVerified: false } }).success).toBe(false);
    expect(fosterEndSchema.safeParse({ outcome: "RETURNED", finalHealthCheck: check, completionException: { reason: "short" } }).success).toBe(false);
  });

  it("no longer accepts extensionDays on completion", () => {
    expect(fosterEndSchema.safeParse({ outcome: "RETURNED", finalHealthCheck: check, extensionDays: 10 }).success).toBe(false);
  });
});

describe("fosterExtendSchema", () => {
  it("accepts a complete recommendation", () => {
    expect(fosterExtendSchema.safeParse(extend).success).toBe(true);
  });

  it.each([-7, 0, 6, 31, 10.5])("rejects %p extension days", (extensionDays) => {
    expect(fosterExtendSchema.safeParse({ ...extend, extensionDays }).success).toBe(false);
  });

  it("requires a reason and both agreements to be stated", () => {
    expect(fosterExtendSchema.safeParse({ ...extend, reason: "too short" }).success).toBe(false);
    const { vetAgreed, ...noVet } = extend; // eslint-disable-line no-unused-vars
    expect(fosterExtendSchema.safeParse(noVet).success).toBe(false);
    const { fostererAgreed, ...noFosterer } = extend; // eslint-disable-line no-unused-vars
    expect(fosterExtendSchema.safeParse(noFosterer).success).toBe(false);
  });
});

describe("returnRequestSchema", () => {
  it("accepts routine and emergency requests with a reason", () => {
    expect(returnRequestSchema.safeParse({ urgency: "routine", reason: "Moving away" }).success).toBe(true);
    expect(returnRequestSchema.safeParse({ urgency: "emergency", reason: "Dog is injured" }).success).toBe(true);
  });
  it("rejects a missing reason or unknown urgency", () => {
    expect(returnRequestSchema.safeParse({ urgency: "emergency" }).success).toBe(false);
    expect(returnRequestSchema.safeParse({ urgency: "urgent", reason: "Dog is injured" }).success).toBe(false);
  });
});
