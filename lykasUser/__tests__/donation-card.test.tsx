import { render, screen, fireEvent } from "@testing-library/react-native";
import { router } from "expo-router";
import DonationCard from "../components/DonationCard";

describe("DonationCard", () => {
  beforeEach(() => jest.mocked(router.push).mockClear());

  it("renders the donate actions and routes to /donate and /donate-goods", () => {
    render(<DonationCard />);

    fireEvent.press(screen.getByLabelText("Donate money"));
    expect(router.push).toHaveBeenCalledWith("/donate");

    fireEvent.press(screen.getByLabelText(/Donate goods/));
    expect(router.push).toHaveBeenCalledWith("/donate-goods");
  });

  it("does not render any quick-amount donation chips", () => {
    render(<DonationCard />);

    expect(screen.queryByText("₱100")).toBeNull();
    expect(screen.queryByText("₱250")).toBeNull();
    expect(screen.queryByText("₱500")).toBeNull();
    expect(screen.queryByText("₱1,000")).toBeNull();
    expect(screen.queryByLabelText(/Donate \d[\d,]* pesos/)).toBeNull();
  });
});
