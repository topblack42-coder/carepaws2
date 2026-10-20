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

describe("Adoption application form", () => {
  beforeEach(() => {
    jest.mocked(api.post).mockReset();
    mockReplace.mockReset();
    mockBack.mockReset();
    mockParams = { id: "pet1" };
    jest.spyOn(Alert, "alert").mockImplementation(() => {});
  });

  it("shows a validation error when phone and address are missing, without calling the API", async () => {
    render(<ApplyToPetScreen />);

    fireEvent.press(screen.getByTestId("apply-submit"));

    await waitFor(() => expect(screen.getByText("Phone and address are required.")).toBeTruthy());
    expect(api.post).not.toHaveBeenCalled();
  });

  it("submits the application with the entered values, including the pet id from the route", async () => {
    jest.mocked(api.post).mockResolvedValue({ data: { success: true } });

    render(<ApplyToPetScreen />);

    fireEvent.changeText(screen.getByTestId("apply-phone"), "0917000000");
    fireEvent.changeText(screen.getByTestId("apply-address"), "123 Main St");
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

    fireEvent.changeText(screen.getByTestId("apply-phone"), "0917000000");
    fireEvent.changeText(screen.getByTestId("apply-address"), "123 Main St");
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

  it("shows the landlord-approval toggle only after renting is enabled", () => {
    render(<ApplyToPetScreen />);

    expect(screen.queryByText("My landlord has approved pet ownership")).toBeNull();

    fireEvent(screen.getByTestId("apply-renting-switch"), "valueChange", true);

    expect(screen.getByText("My landlord has approved pet ownership")).toBeTruthy();
  });

  it("shows a server error message when submission fails, without navigating away", async () => {
    jest.mocked(api.post).mockRejectedValue({
      isAxiosError: true,
      response: { data: { message: "This pet is not currently available" } },
    });

    render(<ApplyToPetScreen />);

    fireEvent.changeText(screen.getByTestId("apply-phone"), "0917000000");
    fireEvent.changeText(screen.getByTestId("apply-address"), "123 Main St");
    fireEvent.press(screen.getByTestId("apply-submit"));

    await waitFor(() => expect(screen.getByText("This pet is not currently available")).toBeTruthy());
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("sends no fosterPeriod for an adoption application", async () => {
    jest.mocked(api.post).mockResolvedValue({ data: { success: true } });
    render(<ApplyToPetScreen />);

    expect(screen.getByText("Adoption application")).toBeTruthy();
    expect(screen.queryByTestId("apply-foster-period")).toBeNull();

    fireEvent.changeText(screen.getByTestId("apply-phone"), "0917000000");
    fireEvent.changeText(screen.getByTestId("apply-address"), "123 Main St");
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

    fireEvent.changeText(screen.getByTestId("apply-phone"), "0917000000");
    fireEvent.changeText(screen.getByTestId("apply-address"), "123 Main St");
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

      fireEvent.changeText(screen.getByTestId("apply-phone"), "0917000000");
      fireEvent.changeText(screen.getByTestId("apply-address"), "123 Main St");
      fireEvent.press(screen.getByTestId("apply-submit"));

      await waitFor(() => expect(screen.getByText("Please tell us how long you can foster.")).toBeTruthy());
      expect(api.post).not.toHaveBeenCalled();
    });

    it("posts type foster with fosterPeriod and shows foster success text", async () => {
      jest.mocked(api.post).mockResolvedValue({ data: { success: true } });
      render(<ApplyToPetScreen />);

      fireEvent.changeText(screen.getByTestId("apply-phone"), "0917000000");
      fireEvent.changeText(screen.getByTestId("apply-address"), "123 Main St");
      fireEvent.changeText(screen.getByTestId("apply-foster-period"), "4 weeks");
      fireEvent.press(screen.getByTestId("apply-submit"));

      await waitFor(() =>
        expect(api.post).toHaveBeenCalledWith(
          "/api/applications",
          expect.objectContaining({ pet: "pet1", type: "foster", fosterPeriod: "4 weeks" })
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
});
