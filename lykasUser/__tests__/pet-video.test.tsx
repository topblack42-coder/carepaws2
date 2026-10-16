import { render, screen, fireEvent, waitFor, act } from "@testing-library/react-native";
import PetVideoPlayer from "../components/PetVideoPlayer";
import PetDetailScreen from "../app/pets/[id]";

// --- expo-video: a controllable fake player -------------------------------
type Listener = (payload: { status: string }) => void;
const mockPlayers: { play: jest.Mock; listeners: Listener[]; status: string; source: string }[] = [];

jest.mock("expo-video", () => {
  const { View: MockView } = jest.requireActual("react-native");
  return {
    useVideoPlayer: (source: string, setup?: (p: unknown) => void) => {
      const ReactActual = jest.requireActual("react");
      const [player] = ReactActual.useState(() => {
        const p = {
          source,
          status: "loading",
          loop: true,
          listeners: [] as Listener[],
          play: jest.fn(),
          addListener: (_event: string, cb: Listener) => {
            p.listeners.push(cb);
            return { remove: () => (p.listeners = p.listeners.filter((l) => l !== cb)) };
          },
        };
        setup?.(p);
        mockPlayers.push(p);
        return p;
      });
      return player;
    },
    VideoView: (props: Record<string, unknown>) => <MockView testID="video-view" {...props} />,
  };
});

jest.mock("expo-image", () => {
  const { View: MockView } = jest.requireActual("react-native");
  return { Image: (props: Record<string, unknown>) => <MockView testID="expo-image" {...props} /> };
});

// --- pet details screen plumbing ------------------------------------------
let mockRouteId = "pet1";
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ id: mockRouteId }),
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
}));
jest.mock("../context/AuthContext", () => ({ useAuth: () => ({ user: null }) }));
jest.mock("react-native-safe-area-context", () => {
  const { View: MockView } = jest.requireActual("react-native");
  return { SafeAreaView: ({ children }: { children: React.ReactNode }) => <MockView>{children}</MockView> };
});
jest.mock("../utils/api", () => {
  const actual = jest.requireActual("../utils/api");
  return { ...actual, api: { get: jest.fn(), post: jest.fn() } };
});
import { api } from "../utils/api";

const VIDEO = {
  url: "https://res.cloudinary.com/demo/video/upload/bella.mp4",
  thumbnailUrl: "https://res.cloudinary.com/demo/video/upload/bella.jpg",
  duration: 75,
  width: 1280,
  height: 720,
};

beforeEach(() => {
  mockPlayers.length = 0;
  mockRouteId = "pet1";
});

describe("PetVideoPlayer", () => {
  it("renders nothing at all when the pet has no video", () => {
    const { toJSON, rerender } = render(<PetVideoPlayer petName="Milo" video={null} />);
    expect(toJSON()).toBeNull();
    rerender(<PetVideoPlayer petName="Milo" video={undefined} />);
    expect(toJSON()).toBeNull();
    rerender(<PetVideoPlayer petName="Milo" video={{ url: "" }} />);
    expect(toJSON()).toBeNull();
  });

  it("shows a thumbnail with a play button and duration, without loading any video yet", () => {
    render(<PetVideoPlayer petName="Bella" video={VIDEO} />);

    expect(screen.getByText("Meet Bella")).toBeTruthy();
    expect(screen.getByText("Get to know Bella through this short introduction video.")).toBeTruthy();
    expect(screen.getByLabelText("Play introduction video of Bella")).toBeTruthy();
    expect(screen.getByText("1:15")).toBeTruthy();
    expect(screen.getByTestId("expo-image").props.source).toEqual({ uri: VIDEO.thumbnailUrl });
    // No player created and no autoplay until the adopter asks for it.
    expect(screen.queryByTestId("video-view")).toBeNull();
    expect(mockPlayers).toHaveLength(0);
  });

  it("plays the pet's own video with native controls and fullscreen once tapped", () => {
    render(<PetVideoPlayer petName="Bella" video={VIDEO} />);
    fireEvent.press(screen.getByLabelText("Play introduction video of Bella"));

    expect(mockPlayers).toHaveLength(1);
    expect(mockPlayers[0].source).toBe(VIDEO.url);
    expect(mockPlayers[0].play).toHaveBeenCalledTimes(1);
    const view = screen.getByTestId("video-view");
    expect(view.props.nativeControls).toBe(true);
    expect(view.props.fullscreenOptions).toEqual({ enable: true });
  });

  it("works without a thumbnail", () => {
    render(<PetVideoPlayer petName="Bella" video={{ url: VIDEO.url }} />);
    expect(screen.queryByTestId("expo-image")).toBeNull();
    expect(screen.getByLabelText("Play introduction video of Bella")).toBeTruthy();
  });

  it("shows a loading indicator while buffering and clears it when ready", () => {
    render(<PetVideoPlayer petName="Bella" video={VIDEO} />);
    fireEvent.press(screen.getByLabelText("Play introduction video of Bella"));
    expect(screen.getByTestId("pet-video-loading")).toBeTruthy();

    act(() => mockPlayers[0].listeners.forEach((l) => l({ status: "readyToPlay" })));
    expect(screen.queryByTestId("pet-video-loading")).toBeNull();
  });

  it("shows a friendly error with a retry that starts a fresh player", () => {
    render(<PetVideoPlayer petName="Bella" video={VIDEO} />);
    fireEvent.press(screen.getByLabelText("Play introduction video of Bella"));

    act(() => mockPlayers[0].listeners.forEach((l) => l({ status: "error" })));
    expect(screen.getByTestId("pet-video-error")).toBeTruthy();
    expect(screen.getByText(/couldn't be played/i)).toBeTruthy();

    fireEvent.press(screen.getByLabelText("Retry video"));
    expect(mockPlayers).toHaveLength(2);
    expect(mockPlayers[1].play).toHaveBeenCalled();
    expect(screen.queryByTestId("pet-video-error")).toBeNull();
  });
});

describe("Pet details screen", () => {
  const basePet = { _id: "pet1", name: "Bella", species: "Dog", breed: "Aspin", status: "Available", description: "Sweet girl", imageUrl: null };

  function mockPet(pet: Record<string, unknown>) {
    jest.mocked(api.get).mockImplementation((url: string) => {
      if (url.startsWith("/api/pets/")) return Promise.resolve({ data: { data: pet } });
      return Promise.resolve({ data: { data: [] } });
    });
  }

  beforeEach(() => jest.mocked(api.get).mockReset());

  it("shows the video section for a pet that has one, alongside the normal profile and apply button", async () => {
    mockPet({ ...basePet, video: VIDEO });
    render(<PetDetailScreen />);

    await waitFor(() => expect(screen.getByText("Meet Bella")).toBeTruthy());
    expect(screen.getByText("About Bella")).toBeTruthy();
    expect(screen.getByText("Apply to adopt Bella")).toBeTruthy();
  });

  it.each([
    ["video: null", { ...basePet, video: null }],
    ["no video field (legacy pet)", basePet],
  ])("looks complete and shows nothing video-related when the pet has no video (%s)", async (_label, pet) => {
    mockPet(pet);
    render(<PetDetailScreen />);

    await waitFor(() => expect(screen.getByText("About Bella")).toBeTruthy());
    expect(screen.queryByText(/Meet Bella/)).toBeNull();
    expect(screen.queryByTestId("pet-video-section")).toBeNull();
    expect(screen.queryByLabelText(/Play introduction video/)).toBeNull();
    expect(screen.getByText("Apply to adopt Bella")).toBeTruthy();
  });

  it("never shows another pet's video if a stale response lands for a different route id", async () => {
    mockRouteId = "pet2";
    mockPet({ ...basePet, _id: "pet1", video: VIDEO }); // server data for a different pet than the route
    render(<PetDetailScreen />);

    await waitFor(() => expect(screen.getByText("About Bella")).toBeTruthy());
    expect(screen.queryByTestId("pet-video-section")).toBeNull();
  });
});
