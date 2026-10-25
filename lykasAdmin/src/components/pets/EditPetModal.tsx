import { useEffect, useState, type FormEvent } from "react";
import Modal from "../ui/Modal";
import Button from "../ui/Button";
import Alert from "../ui/Alert";
import { FormField, Input, Select } from "../ui/FormUI";
import PetVideoField from "./PetVideoField";
import { PetFields, PhotoField, appendPetFields, emptyPetForm, petToForm, type PetFormValues, type ShelterOption } from "./PetFields";
import type { Pet } from "../../hooks/usePets";

interface EditPetModalProps {
  pet: Pet | null;
  onClose: () => void;
  onSubmit: (id: string, formData: FormData) => Promise<boolean>;
  onRemoveVideo?: (id: string) => Promise<boolean>;
  shelters?: ShelterOption[];
  mutating: boolean;
  mutationError: string | null;
}

export default function EditPetModal({ pet, onClose, onSubmit, onRemoveVideo, shelters, mutating, mutationError }: EditPetModalProps) {
  const [values, setValues] = useState<PetFormValues>(emptyPetForm);
  const [status, setStatus] = useState("Available");
  const [healthStatus, setHealthStatus] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [video, setVideo] = useState<File | null>(null);
  const [videoRemoved, setVideoRemoved] = useState(false);

  useEffect(() => {
    if (pet) {
      setValues(petToForm(pet));
      setStatus(pet.status);
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
    appendPetFields(formData, values, { sendBlankText: true });
    formData.append("status", status);
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

        <PetFields idPrefix="edit-pet" values={values} onChange={(patch) => setValues((v) => ({ ...v, ...patch }))} shelters={shelters} />

        <div className="grid grid-cols-2 gap-3">
          <FormField label="Status" htmlFor="edit-pet-status">
            <Select id="edit-pet-status" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="Available">Available</option>
              <option value="Pending">Pending</option>
              <option value="Adopted">Adopted</option>
              <option value="Foster">Foster</option>
            </Select>
          </FormField>
          <FormField label="Health status (optional)" htmlFor="edit-pet-health">
            <Input id="edit-pet-health" value={healthStatus} onChange={(e) => setHealthStatus(e.target.value)} />
          </FormField>
        </div>

        <PhotoField
          idPrefix="edit-pet"
          label="Replace photo (optional)"
          file={image}
          onFileChange={setImage}
          currentUrl={pet.imageUrl ?? null}
          petName={pet.name}
        />

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
