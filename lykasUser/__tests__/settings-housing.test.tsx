import { render, screen, waitFor, fireEvent } from "@testing-library/react-native";
import { Alert } from "react-native";
import * as ImagePicker from "expo-image-picker";
import SettingsScreen from "../app/(tabs)/settings";

jest.mock("expo-image-picker", () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
  MediaTypeOptions: { Images: "Images" },
}));

jest.mock("../utils/api", () => {
  const actual = jest.requireActual("../utils/api");
  return { ...actual, api: { put: jest.fn(), post: jest.fn(), delete: jest.fn(), get: jest.fn() } };
});
jest.mock("../utils/pushNotifications", () => ({
  registerForPushNotificationsAsync: jest.fn(),
  unregisterPushNotifications: jest.fn(),
}));

import { api } from "../utils/api";

const mockRefreshUser = jest.fn();
let mockUser: Record<string, unknown> | null = null;
jest.mock("../context/AuthContext", () => ({ useAuth: () => ({ user: mockUser, refreshUser: mockRefreshUser }) }));

describe("Settings > Housing", () => {
  beforeEach(() => {
    jest.mocked(api.put).mockReset().mockResolvedValue({ data: { success: true } });
    jest.mocked(api.post).mockReset();
    jest.mocked(api.delete).mockReset().mockResolvedValue({ data: { success: true } });
    mockRefreshUser.mockReset().mockResolvedValue(undefined);
    mockUser = { email: "a@b.c", notificationsEnabled: true, phone: "0917", address: "1 Main St", isRenting: false, landlordProofUrl: null };
    jest.spyOn(Alert, "alert").mockImplementation(() => {});
  });

  it("hides the landlord photo section until the user says they are renting", async () => {
    render(<SettingsScreen />);
    expect(screen.queryByTestId("settings-landlord-proof")).toBeNull();

    fireEvent(screen.getByTestId("settings-renting-switch"), "valueChange", true);

    expect(screen.getByTestId("settings-landlord-proof")).toBeTruthy();
    await waitFor(() => expect(api.put).toHaveBeenCalledWith("/api/auth/profile", { isRenting: true }));
  });

  it("puts the renting switch back if saving fails", async () => {
    jest.mocked(api.put).mockRejectedValue({ isAxiosError: true, response: { data: { message: "Nope" } } });
    render(<SettingsScreen />);

    fireEvent(screen.getByTestId("settings-renting-switch"), "valueChange", true);

    await waitFor(() => expect(Alert.alert).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByTestId("settings-landlord-proof")).toBeNull());
  });

  it("uploads the picked photo to the landlord-proof endpoint and shows it", async () => {
    mockUser = { ...mockUser, isRenting: true };
    jest.mocked(ImagePicker.requestMediaLibraryPermissionsAsync).mockResolvedValue({ granted: true } as never);
    jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({
      canceled: false,
      assets: [{ uri: "file:///tmp/letter.jpg", fileName: "letter.jpg", mimeType: "image/jpeg" }],
    } as never);
    jest.mocked(api.post).mockResolvedValue({ data: { success: true, data: { landlordProofUrl: "https://img.example/p.jpg" } } });
    render(<SettingsScreen />);

    fireEvent.press(screen.getByTestId("settings-proof-upload"));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/api/auth/landlord-proof", expect.any(FormData)));
    await waitFor(() => expect(screen.getByTestId("settings-proof-image").props.source).toEqual({ uri: "https://img.example/p.jpg" }));
    expect(mockRefreshUser).toHaveBeenCalled();
  });

  it("does not upload when the user cancels the picker", async () => {
    mockUser = { ...mockUser, isRenting: true };
    jest.mocked(ImagePicker.requestMediaLibraryPermissionsAsync).mockResolvedValue({ granted: true } as never);
    jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({ canceled: true, assets: null } as never);
    render(<SettingsScreen />);

    fireEvent.press(screen.getByTestId("settings-proof-upload"));

    await waitFor(() => expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalled());
    expect(api.post).not.toHaveBeenCalled();
  });

  it("removes an uploaded photo", async () => {
    mockUser = { ...mockUser, isRenting: true, landlordProofUrl: "https://img.example/p.jpg" };
    render(<SettingsScreen />);

    fireEvent.press(screen.getByTestId("settings-proof-remove"));

    await waitFor(() => expect(api.delete).toHaveBeenCalledWith("/api/auth/landlord-proof"));
    await waitFor(() => expect(screen.getByTestId("settings-proof-upload")).toBeTruthy());
  });
});
