import { useEffect, useState, type FormEvent } from "react";
import Modal from "../ui/Modal";
import Button from "../ui/Button";
import Alert from "../ui/Alert";
import { FormField, Input, Select } from "../ui/FormUI";
import TextArea from "../ui/TextArea";
import PetVideoField from "./PetVideoField";
import type { Pet } from "../../hooks/usePets";

interface EditPetModalProps {
  pet: Pet | null;
  onClose: () => void;
  onSubmit: (id: string, formData: FormData) => Promise<boolean>;
  onRemoveVideo?: (id: string) => Promise<boolean>;
  mutating: boolean;
  mutationError: string | null;
}

export default function EditPetModal({ pet, onClose, onSubmit, onRemoveVideo, mutating, mutationError }: EditPetModalProps) {
  const [name, setName] = useState("");
  const [status, setStatus] = useState("Available");
  const [description, setDescription] = useState("");
  const [healthStatus, setHealthStatus] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [video, setVideo] = useState<File | null>(null);
  const [videoRemoved, setVideoRemoved] = useState(false);

  useEffect(() => {
    if (pet) {
      setName(pet.name);
      setStatus(pet.status);
      setDescription(pet.description ?? "");
      setHealthStatus(pet.healthStatus ?? "");
      setImage(null);
      setVideo(null);
      setVideoRemoved(false);
    }
  }, [pet]);

  if (!pet) return null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!pet) return;

    const formData = new FormData();
    formData.append("name", name);
    formData.append("status", status);
    formData.append("description", description);
    formData.append("healthStatus", healthStatus);
    if (image) formData.append("image", image);
    // Only sent when the admin picked a new video; leaving it out keeps the current one.
    if (video) formData.append("video", video);

    const success = await onSubmit(pet._id, formData);
    if (success) onClose();
  }

  return (
    <Modal
      isOpen={!!pet}
      onClose={onClose}
      title={`Edit ${pet.name}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={mutating}>
            Cancel
          </Button>
          <Button type="submit" form="edit-pet-form" loading={mutating}>
            Save changes
          </Button>
        </>
      }
    >
      <form id="edit-pet-form" onSubmit={handleSubmit}>
        {mutationError && (
          <div className="mb-4">
            <Alert tone="danger">{mutationError}</Alert>
          </div>
        )}

        <FormField label="Name" htmlFor="edit-pet-name">
          <Input id="edit-pet-name" required value={name} onChange={(e) => setName(e.target.value)} />
        </FormField>

        <FormField label="Status" htmlFor="edit-pet-status">
          <Select id="edit-pet-status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="Available">Available</option>
            <option value="Pending">Pending</option>
            <option value="Adopted">Adopted</option>
            <option value="Foster">Foster</option>
          </Select>
        </FormField>

        <FormField label="Health status" htmlFor="edit-pet-health">
          <Input id="edit-pet-health" value={healthStatus} onChange={(e) => setHealthStatus(e.target.value)} />
        </FormField>

        <FormField label="Description" htmlFor="edit-pet-description">
          <TextArea id="edit-pet-description" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </FormField>

        <FormField label="Replace photo" htmlFor="edit-pet-image">
          <input
            id="edit-pet-image"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => setImage(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-gray-100 file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-gray-200"
          />
        </FormField>

        <PetVideoField
          idPrefix="edit-pet"
          file={video}
          onFileChange={setVideo}
          existingVideo={videoRemoved ? null : pet.video}
          onRemoveExisting={
            onRemoveVideo
              ? async () => {
                  if (await onRemoveVideo(pet._id)) setVideoRemoved(true);
                }
              : undefined
          }
          removing={mutating}
          uploading={mutating && !!video}
          disabled={mutating}
        />
      </form>
    </Modal>
  );
}
