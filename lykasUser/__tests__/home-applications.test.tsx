import { render, screen, fireEvent } from "@testing-library/react-native";
import { router } from "expo-router";
import ApplicationsSection from "../components/ApplicationsSection";
import { getStageProgress, type ApplicationSummary } from "../utils/applications";

jest.mock("../utils/api", () => ({
  api: { get: jest.fn(), post: jest.fn() },
  getApiErrorMessage: (_e: unknown, fallback: string) => fallback,
}));

const app: ApplicationSummary = {
  _id: "a1",
  pet: { name: "Chini", imageUrl: null },
  type: "adoption",
  status: "pending",
  stage: "interview",
  createdAt: "2026-10-01T00:00:00.000Z",
};

describe("Home applications section", () => {
  beforeEach(() => jest.mocked(router.push).mockClear());

  it("renders an application card and opens its details", () => {
    render(<ApplicationsSection applications={[app]} loading={false} error={null} onRetry={jest.fn()} />);

    expect(screen.getByText("Chini")).toBeTruthy();
    expect(screen.getByText("Step 3 of 8")).toBeTruthy();
    fireEvent.press(screen.getByLabelText(/Chini Adoption application/));
    expect(router.push).toHaveBeenCalledWith("/application-details/a1");
  });

  it("shows the empty state and routes to Adopt", () => {
    render(<ApplicationsSection applications={[]} loading={false} error={null} onRetry={jest.fn()} />);

    expect(screen.getByText("Ready to adopt?")).toBeTruthy();
    fireEvent.press(screen.getByText("Start an application"));
    expect(router.push).toHaveBeenCalledWith("/(tabs)/adopt");
  });

  it("caps the list at three cards", () => {
    const many = ["a", "b", "c", "d"].map((id) => ({ ...app, _id: id, pet: { name: `Pet ${id}` } }));
    render(<ApplicationsSection applications={many} loading={false} error={null} onRetry={jest.fn()} />);
    expect(screen.queryByText("Pet d")).toBeNull();
  });

  it("returns no progress for rejected applications", () => {
    expect(getStageProgress("rejected")).toBeNull();
  });
});
