import { render, screen, fireEvent } from "@testing-library/react-native";
import { router } from "expo-router";
import NotificationBell from "../components/NotificationBell";
import NotificationBanner from "../components/NotificationBanner";
import ReviewCard, { type Review } from "../components/ReviewCard";
import StarRating from "../components/StarRating";
import { getNotificationRoute } from "../utils/notifications";

const review: Review = {
  _id: "r1",
  rating: 5,
  subject: "Amazing team",
  message: "They made adopting Max so easy.",
  createdAt: "2026-10-01T00:00:00.000Z",
  isFeatured: false,
  adminResponse: "Thank you!",
  reviewer: { name: "Maria S." },
  pet: { _id: "p1", name: "Max" },
  isMine: false,
};

describe("NotificationBell", () => {
  beforeEach(() => jest.mocked(router.push).mockClear());

  it("shows an unread badge and opens notifications", () => {
    render(<NotificationBell count={3} />);
    expect(screen.getByText("3")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Notifications, 3 unread"));
    expect(router.push).toHaveBeenCalledWith("/notifications");
  });

  it("hides the badge at zero and caps at 99+", () => {
    const { rerender } = render(<NotificationBell count={0} />);
    expect(screen.queryByTestId("notification-badge")).toBeNull();
    rerender(<NotificationBell count={150} />);
    expect(screen.getByText("99+")).toBeTruthy();
  });
});

describe("NotificationBanner", () => {
  it("deep-links to the application and marks it read", () => {
    const onDismiss = jest.fn();
    render(
      <NotificationBanner
        notification={{ _id: "n1", type: "APPLICATION_APPROVED", title: "Approved", message: "Good news", isRead: false, refModel: "Application", refId: "a1", createdAt: new Date().toISOString() }}
        unreadCount={3}
        onDismiss={onDismiss}
      />
    );
    expect(screen.getByText(/\+2 more/)).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Approved. Good news"));
    expect(onDismiss).toHaveBeenCalled();
    expect(router.push).toHaveBeenCalledWith("/application-details/a1");
  });
});

describe("getNotificationRoute", () => {
  it("falls back to null for unknown targets", () => {
    expect(getNotificationRoute({ type: "GENERAL", refModel: null, refId: null })).toBeNull();
  });
});

describe("Reviews", () => {
  it("renders a review with reviewer, pet chip and shelter reply", () => {
    render(<ReviewCard review={review} />);
    expect(screen.getByText("Maria S.")).toBeTruthy();
    expect(screen.getByText("Adopted Max")).toBeTruthy();
    expect(screen.getByText("CarePaws replied")).toBeTruthy();
  });

  it("hides the shelter reply in compact mode", () => {
    render(<ReviewCard review={review} compact />);
    expect(screen.queryByText("CarePaws replied")).toBeNull();
  });

  it("reports the tapped star", () => {
    const onChange = jest.fn();
    render(<StarRating value={0} onChange={onChange} />);
    fireEvent.press(screen.getByLabelText("4 stars"));
    expect(onChange).toHaveBeenCalledWith(4);
  });
});
