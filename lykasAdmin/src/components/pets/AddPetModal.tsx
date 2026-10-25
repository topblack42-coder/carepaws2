import { useState, type FormEvent } from "react";
import Modal from "../ui/Modal";
import Button from "../ui/Button";
import Alert from "../ui/Alert";
import PetVideoField from "./PetVideoField";
import { PetFields, PhotoField, appendPetFields, emptyPetForm, type PetFormValues, type ShelterOption } from "./PetFields";

interface AddPetModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (formData: FormData) => Promise<boolean>;
  shelters?: ShelterOption[];
  mutating: boolean;
  mutationError: string | null;
}

export default function AddPetModal({ isOpen, onClose, onSubmit, shelters, mutating, mutationError }: AddPetModalProps) {
  const [values, setValues] = useState<PetFormValues>(emptyPetForm);
  const [image, setImage] = useState<File | null>(null);
  const [video, setVideo] = useState<File | null>(null);

  function reset() {
    setValues(emptyPetForm);
    setImage(null);
    setVideo(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const formData = new FormData();
    appendPetFields(formData, values, { sendBlankText: false });
    if (image) formData.append("image", image);
    if (video) formData.append("video", video);

    const success = await onSubmit(formData);
    if (success) {
      reset();
      onClose();
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Add a pet"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={mutating}>
            Cancel
          </Button>
          <Button type="submit" form="add-pet-form" loading={mutating}>
            Add pet
          </Button>
        </>
      }
    >
      <form id="add-pet-form" onSubmit={handleSubmit}>
        {mutationError && (
          <div className="mb-4">
            <Alert tone="danger">{mutationError}</Alert>
          </div>
        )}

        <PetFields idPrefix="pet" values={values} onChange={(patch) => setValues((v) => ({ ...v, ...patch }))} shelters={shelters} />

        <PhotoField idPrefix="pet" label="Photo (optional)" file={image} onFileChange={setImage} />

        <PetVideoField idPrefix="add-pet" file={video} onFileChange={setVideo} uploading={mutating && !!video} disabled={mutating} />
      </form>
    </Modal>
  );
}
