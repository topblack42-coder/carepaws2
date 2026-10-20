import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";
import PetDetailScreen from "../app/pets/[id]";

const mockPush = jest.fn();

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ id: "pet1" }),
  router: { push: (...args: unknown[]) => mockPush(...args), replace: jest.fn(), back: jest.fn() },
}));
jest.mock("../context/AuthContext", () => ({ useAuth: () => ({ user: null }) }));
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

const basePet = { _id: "pet1", name: "Bella", species: "Dog", breed: "Aspin", description: "Sweet girl", imageUrl: null };

function mockPet(status: string) {
  jest.mocked(api.get).mockImplementation((url: string) => {
    if (url.startsWith("/api/pets/")) return Promise.resolve({ data: { data: { ...basePet, status } } });
    return Promise.resolve({ data: { data: [] } });
  });
}

describe("Pet details apply buttons", () => {
  beforeEach(() => {
    jest.mocked(api.get).mockReset();
    mockPush.mockReset();
  });

  it("shows both adopt and foster buttons for an available pet", async () => {
    mockPet("Available");
    render(<PetDetailScreen />);

    await waitFor(() => expect(screen.getByText("Apply to adopt Bella")).toBeTruthy());
    expect(screen.getByText("Apply to foster Bella")).toBeTruthy();
  });

  it("routes the adopt button without a type and the foster button with type=foster", async () => {
    mockPet("Available");
    render(<PetDetailScreen />);

    await waitFor(() => expect(screen.getByText("Apply to adopt Bella")).toBeTruthy());
    fireEvent.press(screen.getByText("Apply to adopt Bella"));
    expect(mockPush).toHaveBeenLastCalledWith("/pets/apply/pet1");

    fireEvent.press(screen.getByText("Apply to foster Bella"));
    expect(mockPush).toHaveBeenLastCalledWith("/pets/apply/pet1?type=foster");
  });

  it.each(["Pending", "Adopted", "Foster"])("shows neither button when the pet is %s", async (status) => {
    mockPet(status);
    render(<PetDetailScreen />);

    await waitFor(() => expect(screen.getByText("About Bella")).toBeTruthy());
    expect(screen.queryByText("Apply to adopt Bella")).toBeNull();
    expect(screen.queryByText("Apply to foster Bella")).toBeNull();
  });
});
