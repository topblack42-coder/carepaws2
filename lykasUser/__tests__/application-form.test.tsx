import { render, screen, waitFor, fireEvent } from "@testing-library/react-native";
import { Alert } from "react-native";
import ApplyToPetScreen from "../app/pets/apply/[id]";

const mockReplace = jest.fn();
const mockBack = jest.fn();
let mockParams: Record<string, string> = { id: "pet1" };

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => mockParams,
  router: { replace: (...args: unknown[]) => mockReplace(...args), back: (...args: unknown[]) => mockBack(...args) },
}));

jest.mock("../utils/api", () => {
  const actual = jest.requireActual("../utils/api");
  return {
    ...actual,
    api: { post: jest.fn(), get: jest.fn() },
  };
});

import { api } from "../utils/api";

let mockUser: { phone?: string | null; address?: string | null; isRenting?: boolean; landlordProofUrl?: string | null } | null = null;
jest.mock("../context/AuthContext", () => ({ useAuth: () => ({ user: mockUser }) }));

describe("Adoption application form", () => {
  beforeEach(() => {
    jest.mocked(api.post).mockReset();
    mockReplace.mockReset();
    mockBack.mockReset();
    mockParams = { id: "pet1" };
    // Phone and address now come from the saved profile (Settings).
    mockUser = { phone: "0917000000", address: "123 Main St" };
    jest.spyOn(Alert, "alert").mockImplementation(() => {});
  });

  it("shows a validation error when phone and address are missing, without calling the API", async () => {
    mockUser = { phone: null, address: null };
    render(<ApplyToPetScreen />);

    fireEvent.press(screen.getByTestId("apply-submit"));

    await waitFor(() => expect(screen.getByText(/Phone and address are required/)).toBeTruthy());
    expect(api.post).not.toHaveBeenCalled();
  });

  it("submits the application with the entered values, including the pet id from the route", async () => {
    jest.mocked(api.post).mockResolvedValue({ data: { success: true } });

    render(<ApplyToPetScreen />);

    fireEvent.press(screen.getByTestId("apply-submit"));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        "/api/applications",
        expect.objectContaining({
          pet: "pet1",
          phone: "0917000000",
          address: "123 Main St",
          type: "adoption",
          isRenting: false,
          landlordApproval: false,
        })
      )
    );

    await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith("Application submitted", expect.any(String), expect.any(Array)));
  });

  it("includes household size and experience when provided", async () => {
    jest.mocked(api.post).mockResolvedValue({ data: { success: true } });

    render(<ApplyToPetScreen />);

    fireEvent.changeText(screen.getByTestId("apply-household"), "4");
    fireEvent.changeText(screen.getByTestId("apply-experience"), "Had two dogs growing up.");
    fireEvent.press(screen.getByTestId("apply-submit"));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        "/api/applications",
        expect.objectContaining({ householdSize: 4, experience: "Had two dogs growing up." })
      )
    );
  });

  it("shows the profile details read-only, with no phone, address or renting inputs", () => {
    mockUser = { phone: "0917000000", address: "123 Main St", isRenting: false };
    render(<ApplyToPetScreen />);

    expect(screen.getByTestId("apply-phone").props.children).toBe("0917000000");
    expect(screen.getByTestId("apply-address").props.children).toBe("123 Main St");
    expect(screen.getByText("Not renting")).toBeTruthy();
    expect(screen.queryByText("I am renting my home")).toBeNull();
  });

  it("blocks a renter who has not uploaded a landlord approval photo in Settings", async () => {
    mockUser = { phone: "0917000000", address: "123 Main St", isRenting: true, landlordProofUrl: null };
    render(<ApplyToPetScreen />);

    expect(screen.getByText("Renting · landlord approval photo missing")).toBeTruthy();
    fireEvent.press(screen.getByTestId("apply-submit"));

    await waitFor(() => expect(screen.getByText(/upload a photo of your landlord's approval/)).toBeTruthy());
    expect(api.post).not.toHaveBeenCalled();
  });

  it("sends renting details from the profile when the landlord photo is on file", async () => {
    mockUser = { phone: "0917000000", address: "123 Main St", isRenting: true, landlordProofUrl: "https://img.example/proof.jpg" };
    jest.mocked(api.post).mockResolvedValue({ data: { success: true } });
    render(<ApplyToPetScreen />);

    expect(screen.getByText("Renting · landlord approval photo added")).toBeTruthy();
    fireEvent.press(screen.getByTestId("apply-submit"));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/api/applications", expect.objectContaining({ isRenting: true, landlordApproval: true }))
    );
    // The photo URL is copied server-side from the profile, never sent by the app.
    expect(jest.mocked(api.post).mock.calls[0][1]).not.toHaveProperty("landlordProofUrl");
  });

  it("shows a server error message when submission fails, without navigating away", async () => {
    jest.mocked(api.post).mockRejectedValue({
      isAxiosError: true,
      response: { data: { message: "This pet is not currently available" } },
    });

    render(<ApplyToPetScreen />);

    fireEvent.press(screen.getByTestId("apply-submit"));

    await waitFor(() => expect(screen.getByText("This pet is not currently available")).toBeTruthy());
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("sends no fosterPeriod for an adoption application", async () => {
    jest.mocked(api.post).mockResolvedValue({ data: { success: true } });
    render(<ApplyToPetScreen />);

    expect(screen.getByText("Adoption application")).toBeTruthy();
    expect(screen.queryByTestId("apply-foster-period")).toBeNull();

    fireEvent.press(screen.getByTestId("apply-submit"));

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const body = jest.mocked(api.post).mock.calls[0][1] as Record<string, unknown>;
    expect(body.type).toBe("adoption");
    expect(body).not.toHaveProperty("fosterPeriod");
  });

  it("falls back to an adoption application for an unknown type param", async () => {
    mockParams = { id: "pet1", type: "foo" };
    jest.mocked(api.post).mockResolvedValue({ data: { success: true } });
    render(<ApplyToPetScreen />);

    expect(screen.getByText("Adoption application")).toBeTruthy();
    expect(screen.queryByTestId("apply-foster-period")).toBeNull();

    fireEvent.press(screen.getByTestId("apply-submit"));

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const body = jest.mocked(api.post).mock.calls[0][1] as Record<string, unknown>;
    expect(body.type).toBe("adoption");
    expect(body).not.toHaveProperty("fosterPeriod");
  });

  describe("foster mode (?type=foster)", () => {
    beforeEach(() => {
      mockParams = { id: "pet1", type: "foster" };
    });

    it("renders the foster title, field and labels", () => {
      render(<ApplyToPetScreen />);

      expect(screen.getByText("Foster application")).toBeTruthy();
      expect(screen.getByText("How long can you foster?")).toBeTruthy();
      expect(screen.getByText("Experience caring for pets (foster)")).toBeTruthy();
      expect(screen.getByTestId("apply-foster-period")).toBeTruthy();
      expect(screen.getByText("Submit foster application")).toBeTruthy();
    });

    it("blocks submit without a foster period", async () => {
      render(<ApplyToPetScreen />);

      fireEvent.press(screen.getByTestId("apply-submit"));

      await waitFor(() => expect(screen.getByText("Please tell us how long you can foster.")).toBeTruthy());
      expect(api.post).not.toHaveBeenCalled();
    });

    it("sends the preferred pickup date and method only when the applicant picks one", async () => {
      jest.mocked(api.post).mockResolvedValue({ data: { success: true } });
      render(<ApplyToPetScreen />);

      fireEvent.press(screen.getByTestId("apply-foster-30"));
      fireEvent.press(screen.getByTestId("apply-submit"));
      await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
      expect(jest.mocked(api.post).mock.calls[0][1]).not.toHaveProperty("preferredPickupDate");

      jest.mocked(api.post).mockClear();
      fireEvent.press(screen.getAllByTestId(/^apply-pickup-\d{4}-\d{2}-\d{2}$/)[2]);
      fireEvent.press(screen.getByText("Deliver to my home"));
      fireEvent.press(screen.getByTestId("apply-submit"));
      await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
      expect(jest.mocked(api.post).mock.calls[0][1]).toEqual(
        expect.objectContaining({ preferredPickupDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), preferredPickupMethod: "Home delivery" })
      );
    });

    it("posts type foster with the chosen foster days and shows foster success text", async () => {
      jest.mocked(api.post).mockResolvedValue({ data: { success: true } });
      render(<ApplyToPetScreen />);

      fireEvent.press(screen.getByTestId("apply-foster-45"));
      fireEvent.press(screen.getByTestId("apply-submit"));

      await waitFor(() =>
        expect(api.post).toHaveBeenCalledWith(
          "/api/applications",
          expect.objectContaining({ pet: "pet1", type: "foster", fosterDays: 45, fosterPeriod: "45 days" })
        )
      );
      await waitFor(() =>
        expect(Alert.alert).toHaveBeenCalledWith(
          "Application submitted",
          "We'll be in touch about your foster application.",
          expect.any(Array)
        )
      );
    });
  });

  it("recommends completing the profile when phone and address are missing", () => {
    mockUser = { phone: null, address: null };
    render(<ApplyToPetScreen />);
    expect(screen.getByTestId("apply-complete-profile")).toBeTruthy();
    expect(screen.getByText(/no phone number and home address/)).toBeTruthy();
  });

  it("uses phone and address from the profile and hides the recommendation", async () => {
    mockUser = { phone: "0917111222", address: "9 Rizal Ave" };
    jest.mocked(api.post).mockResolvedValue({ data: { success: true } });
    render(<ApplyToPetScreen />);

    expect(screen.queryByTestId("apply-complete-profile")).toBeNull();
    fireEvent.press(screen.getByTestId("apply-submit"));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/api/applications", expect.objectContaining({ phone: "0917111222", address: "9 Rizal Ave" }))
    );
  });
});
