import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";

const handlers: Record<string, (...args: unknown[]) => void> = {};
const fakeSocket = {
  active: true,
  connected: true,
  on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
    handlers[event] = cb;
    return fakeSocket;
  }),
  connect: vi.fn(),
  disconnect: vi.fn(),
};
vi.mock("socket.io-client", () => ({ io: vi.fn(() => fakeSocket) }));

const get = vi.fn();
vi.mock("../../src/services/api", () => ({
  API_URL: "http://test",
  api: { get: (...args: unknown[]) => get(...args) },
  tokenStore: { getAccessToken: () => "token" },
  getApiErrorMessage: (_e: unknown, fallback: string) => fallback,
}));
vi.mock("../../src/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "staff-1" } }) }));

import { RealtimeProvider } from "../../src/context/RealtimeContext";
import { useResourceList } from "../../src/hooks/useResourceList";

function Probe() {
  const { rows, loading, error } = useResourceList<{ _id: string; name: string }>("/api/applications");
  return (
    <div>
      <span data-testid="state">{loading ? "loading" : error ? "error" : "ready"}</span>
      <ul>{rows.map((r) => <li key={r._id}>{r.name}</li>)}</ul>
    </div>
  );
}

beforeEach(() => {
  get.mockReset();
  for (const k of Object.keys(handlers)) delete handlers[k];
});

describe("live refresh via useResourceList", () => {
  it("refetches silently when a relevant resource changes, without showing a spinner", async () => {
    get.mockResolvedValueOnce({ data: { data: [{ _id: "1", name: "Rex" }] } });
    render(<RealtimeProvider><Probe /></RealtimeProvider>);
    await screen.findByText("Rex");

    get.mockResolvedValueOnce({ data: { data: [{ _id: "1", name: "Rex" }, { _id: "2", name: "Mochi" }] } });
    act(() => handlers["data:changed"]({ resource: "Application", action: "saved", at: Date.now() }));

    // No loading flash: the old rows stay put while the refetch is in flight.
    expect(screen.getByTestId("state").textContent).toBe("ready");
    await screen.findByText("Mochi");
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("ignores events for unrelated resources", async () => {
    get.mockResolvedValue({ data: { data: [{ _id: "1", name: "Rex" }] } });
    render(<RealtimeProvider><Probe /></RealtimeProvider>);
    await screen.findByText("Rex");

    act(() => handlers["data:changed"]({ resource: "Event", action: "saved", at: Date.now() }));
    await new Promise((r) => setTimeout(r, 50));
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("keeps showing current rows when a background refetch fails", async () => {
    get.mockResolvedValueOnce({ data: { data: [{ _id: "1", name: "Rex" }] } });
    render(<RealtimeProvider><Probe /></RealtimeProvider>);
    await screen.findByText("Rex");

    get.mockRejectedValueOnce(new Error("offline"));
    act(() => handlers["data:changed"]({ resource: "Pet", action: "saved", at: Date.now() }));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    expect(screen.getByText("Rex")).toBeTruthy();
    expect(screen.getByTestId("state").textContent).toBe("ready");
  });

  it("refetches after a reconnect to catch up on missed changes", async () => {
    get.mockResolvedValue({ data: { data: [{ _id: "1", name: "Rex" }] } });
    render(<RealtimeProvider><Probe /></RealtimeProvider>);
    await screen.findByText("Rex");

    act(() => handlers["connect"]()); // first connect: pages already loaded, no refetch
    expect(get).toHaveBeenCalledTimes(1);
    act(() => handlers["connect"]()); // reconnect
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  });
});
