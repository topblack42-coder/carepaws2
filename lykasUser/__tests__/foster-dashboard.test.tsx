import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";
import FosterDashboardScreen from "../app/foster-dashboard";
import { api } from "../utils/api";

jest.mock("expo-router", () => ({ router: { push: jest.fn(), back: jest.fn() } }));
jest.mock("react-native-safe-area-context", () => ({ SafeAreaView: ({ children }: { children: React.ReactNode }) => children }));
// One stable object: the screen lists it as a hook dependency, so a new object per render would reload forever.
const mockFlag = { take: () => false, set: jest.fn() };
jest.mock("../context/RealtimeContext", () => ({
  useRealtimeReload: jest.fn(),
  useSilentFlag: () => mockFlag,
}));

const DAY = 24 * 60 * 60 * 1000;
const placement = (extra = {}) => ({
  _id: "f1",
  pet: { _id: "p1", name: "Bantay", species: "Dog" },
  startDate: new Date(Date.now() - 30 * DAY).toISOString(),
  expectedEndDate: new Date(Date.now() - 2 * DAY).toISOString(),
  status: "active",
  weeklyReportsSubmitted: 3,
  weeklyReportsRequired: 5,
  ...extra,
});

function mockList(rows: unknown[]) {
  jest.spyOn(api, "get").mockResolvedValue({ data: { data: rows, meta: { shelterEmergencyPhone: "0917 000 1111" } } } as never);
}

describe("Foster dashboard: end date, return request, emergency contact", () => {
  beforeEach(() => jest.restoreAllMocks());

  it("tells the fosterer when the placement is past its end date and shows the shelter emergency line", async () => {
    mockList([placement()]);
    render(<FosterDashboardScreen />);
    expect(await screen.findByText(/Ended 2 days ago/)).toBeTruthy();
    expect(screen.getByText(/Shelter emergency line: 0917 000 1111/)).toBeTruthy();
  });

  it("sends an emergency return request with a reason", async () => {
    mockList([placement()]);
    const post = jest.spyOn(api, "post").mockResolvedValue({ data: { success: true } } as never);
    render(<FosterDashboardScreen />);

    fireEvent.press(await screen.findByTestId("foster-return-open-f1"));
    fireEvent.press(screen.getByTestId("foster-urgency-emergency"));
    fireEvent.changeText(screen.getByTestId("foster-return-reason"), "I have to go to the hospital");
    fireEvent.press(screen.getByTestId("foster-return-send"));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/api/foster/f1/return-request", { urgency: "emergency", reason: "I have to go to the hospital" })
    );
  });

  it("does not send a return request without a reason", async () => {
    mockList([placement()]);
    const post = jest.spyOn(api, "post");
    render(<FosterDashboardScreen />);
    fireEvent.press(await screen.findByTestId("foster-return-open-f1"));
    fireEvent.press(screen.getByTestId("foster-return-send"));
    expect(await screen.findByText(/Tell the shelter why/)).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
  });

  it("shows an open request instead of the request button, and saves the emergency contact", async () => {
    mockList([placement({ returnRequest: { urgency: "emergency", reason: "Hospital", status: "open" } })]);
    const put = jest.spyOn(api, "put").mockResolvedValue({ data: { success: true } } as never);
    render(<FosterDashboardScreen />);

    expect(await screen.findByText(/Emergency return requested/)).toBeTruthy();
    expect(screen.queryByTestId("foster-return-open-f1")).toBeNull();

    fireEvent.changeText(screen.getByTestId("foster-contact-name"), "Ana Cruz");
    fireEvent.changeText(screen.getByTestId("foster-contact-phone"), "0999 111 2222");
    fireEvent.press(screen.getByTestId("foster-contact-save"));
    await waitFor(() => expect(put).toHaveBeenCalledWith("/api/foster/f1/emergency-contact", { name: "Ana Cruz", phone: "0999 111 2222" }));
  });

  it("offers no return controls for a completed placement", async () => {
    mockList([placement({ status: "completed" })]);
    render(<FosterDashboardScreen />);
    await screen.findByText("Bantay");
    expect(screen.queryByTestId("foster-return-open-f1")).toBeNull();
  });
});
