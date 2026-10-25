jest.mock("../../src/utils/logger", () => ({ warn: jest.fn(), debug: jest.fn(), info: jest.fn(), error: jest.fn() }));

const mongoose = require("mongoose");
const realtime = require("../../src/utils/realtime");

const { ownersOf, idOf, pending } = realtime._internals;
const A = "507f1f77bcf86cd799439011";
const B = "507f1f77bcf86cd799439012";
const C = "507f1f77bcf86cd799439013";

function fakeIo() {
  const calls = [];
  const chain = (targets, excepts = []) => ({
    except: (room) => chain(targets, [...excepts, room]),
    emit: (event, payload) => calls.push({ targets, excepts, event, payload }),
  });
  return {
    calls,
    to: (t) => chain(Array.isArray(t) ? t : [t]),
    emit: (event, payload) => calls.push({ targets: "ALL", excepts: [], event, payload }),
  };
}

beforeEach(() => {
  jest.useFakeTimers();
  pending.clear();
});
afterEach(() => jest.useRealTimers());

describe("ownersOf / idOf", () => {
  it("collects owner ids from plain objects, ObjectIds and populated docs", () => {
    const rooms = ownersOf({ applicant: new mongoose.Types.ObjectId(A), assignedTo: { _id: B }, user: "nope" }, "Application");
    expect([...rooms].sort()).toEqual([A, B]);
  });

  it("ignores query operators and junk", () => {
    expect(idOf({ $in: [A] })).toBeNull();
    expect(ownersOf({ applicant: { $in: [A] } }, "Application").size).toBe(0);
  });

  it("treats a User document as its own owner", () => {
    expect([...ownersOf({ _id: A }, "User")]).toEqual([A]);
  });
});

describe("emission", () => {
  it("coalesces a burst into one staff event and one owner event without ids", () => {
    const io = fakeIo();
    realtime.setIo(io);
    const { record } = realtime._internals;
    record("Application", "saved", [A], new Set([B]));
    record("Application", "updated", [C], new Set([B]));
    jest.advanceTimersByTime(300);

    expect(io.calls).toHaveLength(2);
    const [staff, owner] = io.calls;
    expect(staff.targets).toEqual([realtime.STAFF_ROOM]);
    expect(staff.payload).toMatchObject({ resource: "Application", action: "changed", ids: [A, C] });
    expect(owner.targets).toEqual([B]);
    expect(owner.excepts).toEqual([realtime.STAFF_ROOM]);
    expect(owner.payload.ids).toBeUndefined();
  });

  it("broadcasts public models to everyone once", () => {
    const io = fakeIo();
    realtime.setIo(io);
    realtime._internals.record("Pet", "saved", [A], new Set());
    jest.advanceTimersByTime(300);
    expect(io.calls).toHaveLength(1);
    expect(io.calls[0]).toMatchObject({ targets: "ALL", event: "data:changed" });
  });

  it("never emits for noisy collections", () => {
    const io = fakeIo();
    realtime.setIo(io);
    realtime._internals.record("ApiLog", "saved", [A], new Set([B]));
    realtime._internals.record("Message", "saved", [A], new Set([B]));
    jest.advanceTimersByTime(300);
    expect(io.calls).toHaveLength(0);
  });

  it("is a no-op before io is attached", () => {
    realtime.setIo(null);
    expect(() => realtime._internals.record("Application", "saved", [A], new Set())).not.toThrow();
    expect(pending.size).toBe(0);
  });
});

describe("plugin", () => {
  it("registers hooks on a schema without throwing", () => {
    const schema = new mongoose.Schema({ name: String });
    expect(() => realtime.realtimePlugin(schema)).not.toThrow();
  });
});
