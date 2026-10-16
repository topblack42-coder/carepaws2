import { useState, type FormEvent } from "react";
import Modal from "../ui/Modal";
import Button from "../ui/Button";
import Alert from "../ui/Alert";
import { FormField, Input, Select } from "../ui/FormUI";
import TextArea from "../ui/TextArea";
import PetVideoField from "./PetVideoField";

interface AddPetModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (formData: FormData) => Promise<boolean>;
  mutating: boolean;
  mutationError: string | null;
}

export default function AddPetModal({ isOpen, onClose, onSubmit, mutating, mutationError }: AddPetModalProps) {
  const [name, setName] = useState("");
  const [species, setSpecies] = useState("Dog");
  const [breed, setBreed] = useState("");
  const [age, setAge] = useState("");
  const [gender, setGender] = useState("Male");
  const [size, setSize] = useState("Medium");
  const [description, setDescription] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [video, setVideo] = useState<File | null>(null);

  function reset() {
    setName("");
    setSpecies("Dog");
    setBreed("");
    setAge("");
    setGender("Male");
    setSize("Medium");
    setDescription("");
    setImage(null);
    setVideo(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const formData = new FormData();
    formData.append("name", name);
    formData.append("species", species);
    if (breed) formData.append("breed", breed);
    if (age) formData.append("age", age);
    formData.append("gender", gender);
    formData.append("size", size);
    if (description) formData.append("description", description);
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

        <FormField label="Name" htmlFor="pet-name">
          <Input id="pet-name" required value={name} onChange={(e) => setName(e.target.value)} />
        </FormField>

        <div className="grid grid-cols-2 gap-3">
          <FormField label="Species" htmlFor="pet-species">
            <Select id="pet-species" value={species} onChange={(e) => setSpecies(e.target.value)}>
              <option value="Dog">Dog</option>
              <option value="Cat">Cat</option>
              <option value="Other">Other</option>
            </Select>
          </FormField>
          <FormField label="Breed" htmlFor="pet-breed">
            <Input id="pet-breed" value={breed} onChange={(e) => setBreed(e.target.value)} />
          </FormField>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <FormField label="Age (years)" htmlFor="pet-age">
            <Input id="pet-age" type="number" min={0} value={age} onChange={(e) => setAge(e.target.value)} />
          </FormField>
          <FormField label="Gender" htmlFor="pet-gender">
            <Select id="pet-gender" value={gender} onChange={(e) => setGender(e.target.value)}>
              <option value="Male">Male</option>
              <option value="Female">Female</option>
            </Select>
          </FormField>
          <FormField label="Size" htmlFor="pet-size">
            <Select id="pet-size" value={size} onChange={(e) => setSize(e.target.value)}>
              <option value="Small">Small</option>
              <option value="Medium">Medium</option>
              <option value="Large">Large</option>
            </Select>
          </FormField>
        </div>

        <FormField label="Description" htmlFor="pet-description">
          <TextArea id="pet-description" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </FormField>

        <FormField label="Photo" htmlFor="pet-image">
          <input
            id="pet-image"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => setImage(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-gray-100 file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-gray-200"
          />
        </FormField>

        <PetVideoField idPrefix="add-pet" file={video} onFileChange={setVideo} uploading={mutating && !!video} disabled={mutating} />
      </form>
    </Modal>
  );
}
