import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import EditPetModal from "../../src/components/pets/EditPetModal";
import type { Pet } from "../../src/hooks/usePets";

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => "blob:mock");
  URL.revokeObjectURL = vi.fn();
});

const PET: Pet = {
  _id: "p1",
  name: "Bella",
  species: "Dog",
  breed: "Labrador",
  age: 3,
  gender: "Female",
  size: "Large",
  temperament: "Friendly",
  energyLevel: "High",
  shelterId: "s1",
  status: "Available",
  imageUrl: "https://example.com/bella.jpg",
};

describe("Edit pet — full profile", () => {
  const onSubmit = vi.fn().mockResolvedValue(true);
  const shelters = [{ _id: "s1", name: "Main Shelter" }, { _id: "s2", name: "Annex" }];
  beforeEach(() => onSubmit.mockClear());

  it("shows the current photo and pre-fills every field", () => {
    render(<EditPetModal pet={PET} shelters={shelters} onClose={() => {}} onSubmit={onSubmit} mutating={false} mutationError={null} />);
    expect(screen.getByTestId("edit-pet-photo-preview")).toHaveAttribute("src", PET.imageUrl!);
    expect(screen.getByLabelText("Breed (optional)")).toHaveValue("Labrador");
    expect(screen.getByLabelText("Age in years (optional)")).toHaveValue(3);
    expect(screen.getByLabelText("Energy level (optional)")).toHaveValue("High");
    expect(screen.getByLabelText("Shelter (optional)")).toHaveValue("s1");
  });

  it("sends edited profile fields and lets text fields be cleared", async () => {
    render(<EditPetModal pet={PET} shelters={shelters} onClose={() => {}} onSubmit={onSubmit} mutating={false} mutationError={null} />);
    await userEvent.selectOptions(screen.getByLabelText("Shelter (optional)"), "s2");
    await userEvent.clear(screen.getByLabelText("Temperament (optional)"));
    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const fd = onSubmit.mock.calls[0][1] as FormData;
    expect(fd.get("shelterId")).toBe("s2");
    expect(fd.get("breed")).toBe("Labrador");
    expect(fd.get("temperament")).toBe("");
    expect(fd.get("size")).toBe("Large");
  });

  it("omits blank optional number/enum fields instead of sending empty strings", async () => {
    const bare: Pet = { _id: "p2", name: "Milo", species: "Cat", status: "Available" };
    render(<EditPetModal pet={bare} shelters={shelters} onClose={() => {}} onSubmit={onSubmit} mutating={false} mutationError={null} />);
    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const fd = onSubmit.mock.calls[0][1] as FormData;
    for (const k of ["age", "gender", "size", "energyLevel", "shelterId"]) expect(fd.has(k)).toBe(false);
    expect(screen.getByText("No photo yet.")).toBeInTheDocument();
  });
});
