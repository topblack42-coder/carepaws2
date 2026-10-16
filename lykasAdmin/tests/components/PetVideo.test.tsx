import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AddPetModal from "../../src/components/pets/AddPetModal";
import EditPetModal from "../../src/components/pets/EditPetModal";
import type { Pet } from "../../src/hooks/usePets";

// jsdom has no object-URL support and never loads media, so stub the first
// and drive the <video> metadata/error events by hand.
beforeEach(() => {
  let n = 0;
  URL.createObjectURL = vi.fn(() => `blob:mock-${++n}`);
  URL.revokeObjectURL = vi.fn();
});

function mp4(name = "bella.mp4", bytes = 1024) {
  return new File([new Uint8Array(bytes)], name, { type: "video/mp4" });
}

function finishValidation(testId: string, duration: number) {
  const validator = screen.getByTestId(testId) as HTMLVideoElement;
  Object.defineProperty(validator, "duration", { value: duration, configurable: true });
  fireEvent.loadedMetadata(validator);
}

const chooseVideo = (file: File) => fireEvent.change(screen.getByLabelText("Pet introduction video file"), { target: { files: [file] } });

const PET_WITH_VIDEO: Pet = {
  _id: "pet1",
  name: "Bella",
  species: "Dog",
  status: "Available",
  video: { url: "https://res.cloudinary.com/demo/video/upload/bella.mp4", thumbnailUrl: "https://res.cloudinary.com/demo/video/upload/bella.jpg", duration: 14 },
};
const PET_WITHOUT_VIDEO: Pet = { _id: "pet2", name: "Milo", species: "Cat", status: "Available" };

describe("Add pet — optional video", () => {
  const onSubmit = vi.fn().mockResolvedValue(true);
  const renderAdd = () => render(<AddPetModal isOpen onClose={() => {}} onSubmit={onSubmit} mutating={false} mutationError={null} />);

  beforeEach(() => onSubmit.mockClear());

  it("labels the section as optional and states the limits", () => {
    renderAdd();
    expect(screen.getByText("Pet Introduction Video (Optional)")).toBeInTheDocument();
    expect(screen.getByText(/this is optional/i)).toBeInTheDocument();
    expect(screen.getByText(/MP4 \(H\.264\) · up to 25 MB · up to 60 seconds/)).toBeInTheDocument();
  });

  it("saves a pet with no video — the form never requires one", async () => {
    renderAdd();
    await userEvent.type(screen.getByLabelText("Name"), "Bella");
    await userEvent.click(screen.getByRole("button", { name: /add pet/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const formData = onSubmit.mock.calls[0][0] as FormData;
    expect(formData.get("name")).toBe("Bella");
    expect(formData.has("video")).toBe(false);
  });

  it("previews a valid video and sends it with the form", async () => {
    renderAdd();
    await userEvent.type(screen.getByLabelText("Name"), "Bella");

    chooseVideo(mp4());
    finishValidation("add-pet-video-validator", 20);

    expect(await screen.findByTestId("add-pet-video-preview")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /add pet/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const sent = (onSubmit.mock.calls[0][0] as FormData).get("video") as File;
    expect(sent.name).toBe("bella.mp4");
  });

  it("lets the admin cancel a selected video before saving", async () => {
    renderAdd();
    await userEvent.type(screen.getByLabelText("Name"), "Bella");
    chooseVideo(mp4());
    finishValidation("add-pet-video-validator", 20);
    await userEvent.click(await screen.findByRole("button", { name: /remove selection/i }));

    expect(screen.queryByTestId("add-pet-video-preview")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /add pet/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect((onSubmit.mock.calls[0][0] as FormData).has("video")).toBe(false);
  });

  it("rejects a non-MP4 file with a clear message", () => {
    renderAdd();
    chooseVideo(new File(["x"], "clip.avi", { type: "video/x-msvideo" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/unsupported format/i);
    expect(screen.queryByTestId("add-pet-video-preview")).not.toBeInTheDocument();
  });

  it("rejects a video over the size limit", () => {
    renderAdd();
    const big = mp4("big.mp4", 10);
    Object.defineProperty(big, "size", { value: 30 * 1024 * 1024 });
    chooseVideo(big);
    expect(screen.getByRole("alert")).toHaveTextContent(/maximum is 25 MB/i);
  });

  it("rejects a video that is too long", async () => {
    renderAdd();
    chooseVideo(mp4());
    finishValidation("add-pet-video-validator", 95);
    expect(await screen.findByRole("alert")).toHaveTextContent(/maximum is 60 seconds/i);
    expect(screen.queryByTestId("add-pet-video-preview")).not.toBeInTheDocument();
  });

  it("shows a clear error when the browser can't load the video, and allows another choice", async () => {
    renderAdd();
    chooseVideo(mp4("corrupt.mp4"));
    fireEvent.error(screen.getByTestId("add-pet-video-validator"));
    expect(await screen.findByRole("alert")).toHaveTextContent(/can't be previewed/i);

    chooseVideo(mp4("good.mp4"));
    finishValidation("add-pet-video-validator", 10);
    expect(await screen.findByTestId("add-pet-video-preview")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("Edit pet — optional video", () => {
  const onSubmit = vi.fn().mockResolvedValue(true);
  const onRemoveVideo = vi.fn().mockResolvedValue(true);
  const renderEdit = (pet: Pet) =>
    render(<EditPetModal pet={pet} onClose={() => {}} onSubmit={onSubmit} onRemoveVideo={onRemoveVideo} mutating={false} mutationError={null} />);

  beforeEach(() => {
    onSubmit.mockClear();
    onRemoveVideo.mockClear();
  });

  it("shows the current video for a pet that has one", () => {
    renderEdit(PET_WITH_VIDEO);
    expect(screen.getByTestId("edit-pet-video-current")).toHaveAttribute("src", PET_WITH_VIDEO.video!.url);
    expect(screen.getByRole("button", { name: /replace video/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /remove video/i })).toBeInTheDocument();
  });

  it("offers a plain picker (and no current-video block) for a pet without one", () => {
    renderEdit(PET_WITHOUT_VIDEO);
    expect(screen.queryByTestId("edit-pet-video-current")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /choose a video/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /remove video/i })).not.toBeInTheDocument();
  });

  it("does not send a video field when only ordinary fields are edited", async () => {
    renderEdit(PET_WITH_VIDEO);
    await userEvent.clear(screen.getByLabelText("Name"));
    await userEvent.type(screen.getByLabelText("Name"), "Bella II");
    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const [id, formData] = onSubmit.mock.calls[0] as [string, FormData];
    expect(id).toBe("pet1");
    expect(formData.get("name")).toBe("Bella II");
    expect(formData.has("video")).toBe(false);
    expect(onRemoveVideo).not.toHaveBeenCalled();
  });

  it("adds a video to an existing pet that has none", async () => {
    renderEdit(PET_WITHOUT_VIDEO);
    chooseVideo(mp4("late.mp4"));
    finishValidation("edit-pet-video-validator", 12);
    await screen.findByTestId("edit-pet-video-preview");
    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(((onSubmit.mock.calls[0][1] as FormData).get("video") as File).name).toBe("late.mp4");
  });

  it("replaces a video: stages the new file, can fall back to the current one, and sends it on save", async () => {
    renderEdit(PET_WITH_VIDEO);
    chooseVideo(mp4("new.mp4"));
    finishValidation("edit-pet-video-validator", 12);

    expect(await screen.findByTestId("edit-pet-video-preview")).toBeInTheDocument();
    expect(screen.getByText(/replaces the current video when you save/i)).toBeInTheDocument();
    expect(screen.queryByTestId("edit-pet-video-current")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /keep current video/i }));
    expect(screen.getByTestId("edit-pet-video-current")).toBeInTheDocument();

    chooseVideo(mp4("new.mp4"));
    finishValidation("edit-pet-video-validator", 12);
    await screen.findByTestId("edit-pet-video-preview");
    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(((onSubmit.mock.calls[0][1] as FormData).get("video") as File).name).toBe("new.mp4");
  });

  it("asks for confirmation before removing, then calls the explicit remove action", async () => {
    renderEdit(PET_WITH_VIDEO);
    await userEvent.click(screen.getByRole("button", { name: /^remove video$/i }));
    expect(onRemoveVideo).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: /yes, remove video/i }));
    await waitFor(() => expect(onRemoveVideo).toHaveBeenCalledWith("pet1"));
    // The current-video block goes away and the picker returns.
    await waitFor(() => expect(screen.queryByTestId("edit-pet-video-current")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: /choose a video/i })).toBeInTheDocument();
    // Removing never saves the form.
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("can back out of the removal confirmation", async () => {
    renderEdit(PET_WITH_VIDEO);
    await userEvent.click(screen.getByRole("button", { name: /^remove video$/i }));
    await userEvent.click(screen.getByRole("button", { name: /keep it/i }));
    expect(onRemoveVideo).not.toHaveBeenCalled();
    expect(screen.getByTestId("edit-pet-video-current")).toBeInTheDocument();
  });
});
