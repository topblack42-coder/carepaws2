import { useCallback, useState } from "react";
import { api, getApiErrorMessage } from "../services/api";
import { useResourceList } from "./useResourceList";

export interface PetVideo {
  url: string;
  thumbnailUrl?: string | null;
  publicId?: string;
  duration?: number | null;
  mimeType?: string;
  size?: number | null;
  width?: number | null;
  height?: number | null;
}

export interface Pet {
  _id: string;
  name: string;
  species: "Dog" | "Cat" | "Other";
  breed?: string;
  age?: number;
  gender?: "Male" | "Female";
  size?: "Small" | "Medium" | "Large";
  temperament?: string;
  energyLevel?: "Low" | "Medium" | "High";
  status: "Available" | "Pending" | "Adopted" | "Foster";
  imageUrl?: string | null;
  /** Optional introduction video; null/absent when the pet has none. */
  video?: PetVideo | null;
  shelterId?: string | null;
  healthStatus?: string;
  description?: string;
  /** True when the pet has been archived (soft-deleted); can be restored. */
  isDeleted?: boolean;
}

/**
 * Pet list + CRUD, built on the shared list hook (§7.3) plus the
 * mutation calls PetManagement/ManagePets need. Uses /api/pets/admin so
 * staff see the full set (including Adopted/Foster/soft-deleted),
 * unlike the public /api/pets catalog endpoint.
 */
export function usePets() {
  const list = useResourceList<Pet>("/api/pets/admin");
  const [mutating, setMutating] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);

  const createPet = useCallback(
    async (formData: FormData) => {
      setMutating(true);
      setMutationError(null);
      try {
        // Don't set Content-Type manually here — axios/the browser needs to
        // compute it (including the multipart boundary) from the FormData
        // instance itself. A hardcoded "multipart/form-data" header omits the
        // boundary parameter, which makes the body unparsable server-side.
        await api.post("/api/pets", formData);
        list.reload();
        return true;
      } catch (err) {
        setMutationError(getApiErrorMessage(err, "Failed to create pet"));
        return false;
      } finally {
        setMutating(false);
      }
    },
    [list]
  );

  const updatePet = useCallback(
    async (id: string, formData: FormData) => {
      setMutating(true);
      setMutationError(null);
      try {
        // See createPet above — let axios set Content-Type (with boundary).
        await api.put(`/api/pets/${id}`, formData);
        list.reload();
        return true;
      } catch (err) {
        setMutationError(getApiErrorMessage(err, "Failed to update pet"));
        return false;
      } finally {
        setMutating(false);
      }
    },
    [list]
  );

  // Removing a video is its own explicit call — editing other fields never
  // touches it, and this never touches anything but the video.
  const removePetVideo = useCallback(
    async (id: string) => {
      setMutating(true);
      setMutationError(null);
      try {
        await api.delete(`/api/pets/${id}/video`);
        list.reload();
        return true;
      } catch (err) {
        setMutationError(getApiErrorMessage(err, "Failed to remove video"));
        return false;
      } finally {
        setMutating(false);
      }
    },
    [list]
  );

  const deletePet = useCallback(
    async (id: string) => {
      setMutating(true);
      setMutationError(null);
      try {
        await api.delete(`/api/pets/${id}`);
        list.reload();
        return true;
      } catch (err) {
        setMutationError(getApiErrorMessage(err, "Failed to archive pet"));
        return false;
      } finally {
        setMutating(false);
      }
    },
    [list]
  );

  const restorePet = useCallback(
    async (id: string) => {
      setMutating(true);
      try {
        await api.post(`/api/pets/${id}/restore`);
        list.reload();
        return true;
      } catch (err) {
        setMutationError(getApiErrorMessage(err, "Failed to restore pet"));
        return false;
      } finally {
        setMutating(false);
      }
    },
    [list]
  );

  return { ...list, createPet, updatePet, removePetVideo, deletePet, restorePet, mutating, mutationError };
}
