import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";
import { Alert } from "react-native";
import ProfileScreen from "../app/(tabs)/profile";
import VerifyEmailScreen from "../app/verify-email";
import PetDetailScreen from "../app/pets/[id]";
import { promptVerifyEmail } from "../utils/emailVerification";

const mockPush = jest.fn();
const mockReplace = jest.fn();
let mockParams: Record<string, string> = {};
let mockUser: Record<string, unknown> | null = null;
const mockRefreshUser = jest.fn(() => Promise.resolve());

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => mockParams,
  router: { push: (...a: unknown[]) => mockPush(...a), replace: (...a: unknown[]) => mockReplace(...a), back: jest.fn() },
}));
jest.mock("../context/AuthContext", () => ({
  useAuth: () => ({ user: mockUser, logout: jest.fn(), refreshUser: mockRefreshUser }),
}));
jest.mock("react-native-safe-area-context", () => {
  const { View: MockView } = jest.requireActual("react-native");
  return { SafeAreaView: ({ children }: { children: React.ReactNode }) => <MockView>{children}</MockView> };
});
jest.mock("expo-image", () => {
  const { View: MockView } = jest.requireActual("react-native");
  return { Image: (props: Record<string, unknown>) => <MockView {...props} /> };
});
jest.mock("../components/PetVideoPlayer", () => ({ __esModule: true, default: () => null }));
jest.mock("../utils/api", () => {
  const actual = jest.requireActual("../utils/api");
  return { ...actual, api: { get: jest.fn(), post: jest.fn() } };
});

import { api } from "../utils/api";

const unverified = { id: "u1", role: "user", displayName: "Kern", email: "k@example.com", emailVerified: false, identityVerificationStatus: "unverified" };
const verified = { ...unverified, emailVerified: true };

beforeEach(() => {
  jest.mocked(api.post).mockReset();
  jest.mocked(api.get).mockReset();
  mockPush.mockReset();
  mockReplace.mockReset();
  mockRefreshUser.mockClear();
  mockParams = {};
  mockUser = unverified;
  jest.spyOn(Alert, "alert").mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

describe("Profile verification banner", () => {
  it("is shown only when the email is unverified", () => {
    const { unmount } = render(<ProfileScreen />);
    expect(screen.getByText("Email not verified")).toBeTruthy();
    expect(screen.getByTestId("resend-verification-button")).toBeTruthy();
    unmount();

    mockUser = verified;
    render(<ProfileScreen />);
    expect(screen.queryByText("Email not verified")).toBeNull();
    expect(screen.queryByTestId("email-verification-banner")).toBeNull();
  });

  it("sends the email, then disables the button with a countdown", async () => {
    jest.mocked(api.post).mockResolvedValue({ data: { success: true, data: { emailSkipped: false } } });
    render(<ProfileScreen />);

    fireEvent.press(screen.getByTestId("resend-verification-button"));

    await waitFor(() => expect(screen.getByText("Resend in 60s")).toBeTruthy());
    expect(api.post).toHaveBeenCalledWith("/api/auth/resend-verification");
    expect(screen.getByTestId("resend-verification-button").props.accessibilityState.disabled).toBe(true);

    fireEvent.press(screen.getByTestId("resend-verification-button"));
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it("uses retryAfterSeconds from a 429 as the countdown and shows the server message", async () => {
    jest.mocked(api.post).mockRejectedValue({
      isAxiosError: true,
      response: { status: 429, data: { message: "Please wait 42 seconds before requesting another verification email", retryAfterSeconds: 42 } },
    });
    render(<ProfileScreen />);

    fireEvent.press(screen.getByTestId("resend-verification-button"));

    await waitFor(() => expect(screen.getByText("Resend in 42s")).toBeTruthy());
    expect(screen.getByText(/Please wait 42 seconds/)).toBeTruthy();
  });

  it("shows an error and no countdown when the provider fails", async () => {
    jest.mocked(api.post).mockRejectedValue({
      isAxiosError: true,
      response: { status: 502, data: { message: "We couldn't send the verification email right now. Please try again shortly" } },
    });
    render(<ProfileScreen />);

    fireEvent.press(screen.getByTestId("resend-verification-button"));

    await waitFor(() => expect(screen.getByText(/couldn't send the verification email/)).toBeTruthy());
    expect(screen.getByText("Resend email")).toBeTruthy();
  });
});

describe("verify-email screen", () => {
  it("refreshes the signed-in user after a successful verification", async () => {
    mockParams = { token: "abc" };
    jest.mocked(api.post).mockResolvedValue({ data: { success: true } });
    render(<VerifyEmailScreen />);

    await waitFor(() => expect(screen.getByText("Email verified")).toBeTruthy());
    expect(mockRefreshUser).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it("offers a new link to a signed-in user when the link failed, and requests it", async () => {
    mockParams = { token: "expired" };
    jest.mocked(api.post).mockImplementation((url: string) =>
      url === "/api/auth/verify-email"
        ? Promise.reject({ isAxiosError: true, response: { status: 400, data: { message: "Invalid or expired verification token" } } })
        : Promise.resolve({ data: { success: true, data: { emailSkipped: false } } })
    );
    render(<VerifyEmailScreen />);

    await waitFor(() => expect(screen.getByText("Invalid or expired verification token")).toBeTruthy());
    expect(mockRefreshUser).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId("verify-request-new-link"));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/api/auth/resend-verification"));
    await waitFor(() => expect(screen.getByText("Verification email sent. Check your inbox.")).toBeTruthy());
  });

  it("sends a signed-out user to log in instead", async () => {
    mockUser = null;
    mockParams = { token: "expired" };
    jest.mocked(api.post).mockRejectedValue({ isAxiosError: true, response: { status: 400, data: { message: "Invalid or expired verification token" } } });
    render(<VerifyEmailScreen />);

    await waitFor(() => expect(screen.getByText("Log in to request a new link")).toBeTruthy());
    expect(screen.queryByTestId("verify-request-new-link")).toBeNull();

    fireEvent.press(screen.getByText("Log in to request a new link"));
    expect(mockReplace).toHaveBeenCalledWith("/(auth)/logIn");
  });
});

describe("EMAIL_NOT_VERIFIED prompt", () => {
  it("promptVerifyEmail shows a friendly alert whose Resend action calls the endpoint", async () => {
    jest.mocked(api.post).mockResolvedValue({ data: { success: true, data: { emailSkipped: false } } });
    promptVerifyEmail();

    expect(Alert.alert).toHaveBeenCalledWith("Verify your email", expect.stringContaining("verify your email"), expect.any(Array));
    const buttons = jest.mocked(Alert.alert).mock.calls[0][2] as { text: string; onPress?: () => Promise<void> }[];
    await buttons.find((b) => b.text === "Resend email")!.onPress!();

    expect(api.post).toHaveBeenCalledWith("/api/auth/resend-verification");
    expect(Alert.alert).toHaveBeenLastCalledWith("Check your inbox", expect.any(String));
  });

  it("pet detail prompts instead of opening the form when the member is unverified (adopt and foster)", async () => {
    mockParams = { id: "pet1" };
    jest.mocked(api.get).mockImplementation((url: string) =>
      Promise.resolve({ data: { data: url.startsWith("/api/pets/") ? { _id: "pet1", name: "Bella", species: "Dog", status: "Available" } : [] } })
    );
    render(<PetDetailScreen />);

    await waitFor(() => expect(screen.getByText("Apply to adopt Bella")).toBeTruthy());
    fireEvent.press(screen.getByText("Apply to adopt Bella"));
    fireEvent.press(screen.getByText("Apply to foster Bella"));

    expect(Alert.alert).toHaveBeenCalledTimes(2);
    expect(Alert.alert).toHaveBeenCalledWith("Verify your email", expect.any(String), expect.any(Array));
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("pet detail opens the form for a verified member", async () => {
    mockUser = verified;
    mockParams = { id: "pet1" };
    jest.mocked(api.get).mockImplementation((url: string) =>
      Promise.resolve({ data: { data: url.startsWith("/api/pets/") ? { _id: "pet1", name: "Bella", species: "Dog", status: "Available" } : [] } })
    );
    render(<PetDetailScreen />);

    await waitFor(() => expect(screen.getByText("Apply to foster Bella")).toBeTruthy());
    fireEvent.press(screen.getByText("Apply to foster Bella"));

    expect(mockPush).toHaveBeenCalledWith("/pets/apply/pet1?type=foster");
    expect(Alert.alert).not.toHaveBeenCalled();
  });
});
