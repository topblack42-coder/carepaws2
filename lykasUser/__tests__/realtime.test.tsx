import { useCallback, useState } from "react";
import { Text } from "react-native";
import { act, render, screen, waitFor } from "@testing-library/react-native";

const mockHandlers: Record<string, (...args: unknown[]) => void> = {};
const mockSocket: { active: boolean; connected: boolean; on: jest.Mock; connect: jest.Mock; disconnect: jest.Mock } = {
  active: true,
  connected: true,
  on: jest.fn((event: string, cb: (...args: unknown[]) => void): unknown => {
    mockHandlers[event] = cb;
    return mockSocket;
  }),
  connect: jest.fn(),
  disconnect: jest.fn(),
};
jest.mock("socket.io-client", () => ({ io: jest.fn(() => mockSocket) }));

jest.mock("../utils/api", () => ({
  API_URL: "http://test",
  api: { get: jest.fn(() => Promise.resolve({ data: {} })) },
  tokenStore: { getAccessToken: () => Promise.resolve("token") },
}));

const mockRefreshUser = jest.fn(() => Promise.resolve());
jest.mock("../context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-1" }, refreshUser: mockRefreshUser }),
}));

import { RealtimeProvider, useRealtimeReload, useSilentFlag } from "../context/RealtimeContext";

const fetchRows = jest.fn();

/** Mirrors how the real screens use the hooks. */
function Screen() {
  const [rows, setRows] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const live = useSilentFlag();

  const load = useCallback(async () => {
    const silent = live.take();
    if (!silent) setLoading(true);
    try {
      setRows(await fetchRows());
    } catch {
      /* the real screens show an error unless silent */
    } finally {
      setLoading(false);
    }
  }, [live]);

  useRealtimeReload(["Application"], load, live);
  useState(() => {
    void load();
  });

  return <Text testID="out">{loading ? "loading" : rows.join(",")}</Text>;
}

beforeEach(() => {
  fetchRows.mockReset();
  mockRefreshUser.mockClear();
  for (const k of Object.keys(mockHandlers)) delete mockHandlers[k];
});

describe("live refresh", () => {
  it("refetches in place when a relevant resource changes, without a loading flash", async () => {
    fetchRows.mockResolvedValueOnce(["Rex"]);
    render(<RealtimeProvider><Screen /></RealtimeProvider>);
    await waitFor(() => expect(screen.getByTestId("out").props.children).toBe("Rex"));

    fetchRows.mockResolvedValueOnce(["Rex", "Mochi"]);
    act(() => mockHandlers["data:changed"]({ resource: "Application", action: "saved", at: Date.now() }));

    expect(screen.getByTestId("out").props.children).toBe("Rex"); // not "loading"
    await waitFor(() => expect(screen.getByTestId("out").props.children).toBe("Rex,Mochi"));
  });

  it("ignores unrelated resources", async () => {
    fetchRows.mockResolvedValue(["Rex"]);
    render(<RealtimeProvider><Screen /></RealtimeProvider>);
    await waitFor(() => expect(screen.getByTestId("out").props.children).toBe("Rex"));

    act(() => mockHandlers["data:changed"]({ resource: "Event", action: "saved", at: Date.now() }));
    await new Promise((r) => setTimeout(r, 30));
    expect(fetchRows).toHaveBeenCalledTimes(1);
  });

  it("catches up after a reconnect", async () => {
    fetchRows.mockResolvedValue(["Rex"]);
    render(<RealtimeProvider><Screen /></RealtimeProvider>);
    await waitFor(() => expect(screen.getByTestId("out").props.children).toBe("Rex"));

    act(() => mockHandlers["connect"]()); // first connect: nothing to catch up
    expect(fetchRows).toHaveBeenCalledTimes(1);
    act(() => mockHandlers["connect"]()); // reconnect
    await waitFor(() => expect(fetchRows).toHaveBeenCalledTimes(2));
  });

  it("refreshes the signed-in user when their own account changes", async () => {
    fetchRows.mockResolvedValue([]);
    render(<RealtimeProvider><Screen /></RealtimeProvider>);
    act(() => mockHandlers["data:changed"]({ resource: "User", action: "updated", at: Date.now() }));
    expect(mockRefreshUser).toHaveBeenCalledTimes(1);
  });
});
