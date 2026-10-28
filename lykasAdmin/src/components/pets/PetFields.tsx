import { useEffect, useMemo } from "react";
import { FormField, Input, Select } from "../ui/FormUI";
import TextArea from "../ui/TextArea";
import type { Pet } from "../../hooks/usePets";

export interface ShelterOption {
  _id: string;
  name: string;
}

/** Text-form representation of a pet; every value is a string so inputs stay controlled. */
export interface PetFormValues {
  name: string;
  species: string;
  breed: string;
  age: string;
  gender: string;
  size: string;
  temperament: string;
  energyLevel: string;
  shelterId: string;
  description: string;
}

/** Defaults for a brand-new pet (gender/size keep the original Add-modal defaults). */
export const emptyPetForm: PetFormValues = {
  name: "",
  species: "Dog",
  breed: "",
  age: "",
  gender: "Male",
  size: "Medium",
  temperament: "",
  energyLevel: "",
  shelterId: "",
  description: "",
};

/** shelterId can arrive as a plain id or a populated { _id } object. */
const TEMPERAMENTS = ["Calm", "Playful", "Shy", "Energetic", "Affectionate", "Independent"];

function shelterIdOf(pet: Pet): string {
  const s = pet.shelterId as unknown;
  if (!s) return "";
  if (typeof s === "string") return s;
  return (s as { _id?: string })._id ?? "";
}

export function petToForm(pet: Pet): PetFormValues {
  return {
    name: pet.name,
    species: pet.species,
    breed: pet.breed ?? "",
    age: pet.age != null ? String(pet.age) : "",
    gender: pet.gender ?? "",
    size: pet.size ?? "",
    // Older records may hold free text (e.g. "Friendly"); treat anything outside the allowed list as not specified.
    temperament: TEMPERAMENTS.includes(pet.temperament as never) ? (pet.temperament as string) : "",
    energyLevel: pet.energyLevel ?? "",
    shelterId: shelterIdOf(pet),
    description: pet.description ?? "",
  };
}

/**
 * Writes the form into FormData.
 *
 * Free-text fields (breed, temperament, description) are sent even when blank
 * on edit so an admin can clear them. Number/enum/id fields (age, gender, size,
 * energy level, shelter) are only sent when filled in — an empty string would
 * fail server-side casting/enum validation.
 */
export function appendPetFields(fd: FormData, v: PetFormValues, opts: { sendBlankText: boolean }) {
  fd.append("name", v.name);
  fd.append("species", v.species);
  const text: [string, string][] = [
    ["breed", v.breed],
    ["temperament", v.temperament],
    ["description", v.description],
  ];
  for (const [key, value] of text) {
    if (value || opts.sendBlankText) fd.append(key, value);
  }
  const optional: [string, string][] = [
    ["age", v.age],
    ["gender", v.gender],
    ["size", v.size],
    ["energyLevel", v.energyLevel],
    ["shelterId", v.shelterId],
  ];
  for (const [key, value] of optional) {
    if (value) fd.append(key, value);
  }
}

interface PetFieldsProps {
  idPrefix: string;
  values: PetFormValues;
  onChange: (patch: Partial<PetFormValues>) => void;
  shelters?: ShelterOption[];
}

export function PetFields({ idPrefix, values, onChange }: PetFieldsProps) {
  const id = (n: string) => `${idPrefix}-${n}`;
  // Keep a pet's current shelter selectable even if the shelter list hasn't loaded / was filtered.
  // Hidden for now (shelter/cage management): const hasCurrentShelter = !values.shelterId || shelters.some((s) => s._id === values.shelterId);

  return (
    <>
      <FormField label="Name" htmlFor={id("name")}>
        <Input id={id("name")} required value={values.name} onChange={(e) => onChange({ name: e.target.value })} />
      </FormField>

      <div className="grid grid-cols-2 gap-3">
        <FormField label="Species" htmlFor={id("species")}>
          <Select id={id("species")} value={values.species} onChange={(e) => onChange({ species: e.target.value })}>
            <option value="Dog">Dog</option>
            <option value="Cat">Cat</option>
            <option value="Other">Other</option>
          </Select>
        </FormField>
        <FormField label="Breed (optional)" htmlFor={id("breed")}>
          <Input id={id("breed")} value={values.breed} onChange={(e) => onChange({ breed: e.target.value })} />
        </FormField>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <FormField label="Age in years (optional)" htmlFor={id("age")}>
          <Input id={id("age")} type="number" min={0} value={values.age} onChange={(e) => onChange({ age: e.target.value })} />
        </FormField>
        <FormField label="Gender (optional)" htmlFor={id("gender")}>
          <Select id={id("gender")} value={values.gender} onChange={(e) => onChange({ gender: e.target.value })}>
            <option value="">Not specified</option>
            <option value="Male">Male</option>
            <option value="Female">Female</option>
          </Select>
        </FormField>
        <FormField label="Size (optional)" htmlFor={id("size")}>
          <Select id={id("size")} value={values.size} onChange={(e) => onChange({ size: e.target.value })}>
            <option value="">Not specified</option>
            <option value="Small">Small</option>
            <option value="Medium">Medium</option>
            <option value="Large">Large</option>
          </Select>
        </FormField>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <FormField label="Energy level (optional)" htmlFor={id("energy")}>
          <Select id={id("energy")} value={values.energyLevel} onChange={(e) => onChange({ energyLevel: e.target.value })}>
            <option value="">Not specified</option>
            <option value="Low">Low</option>
            <option value="Medium">Medium</option>
            <option value="High">High</option>
          </Select>
        </FormField>
        {/* Hidden for now (shelter/cage management):
        <FormField label="Shelter (optional)" htmlFor={id("shelter")}>
          <Select id={id("shelter")} value={values.shelterId} onChange={(e) => onChange({ shelterId: e.target.value })}>
            <option value="">Not assigned</option>
            {!hasCurrentShelter && <option value={values.shelterId}>Current shelter</option>}
            {shelters.map((s) => (
              <option key={s._id} value={s._id}>
                {s.name}
              </option>
            ))}
          </Select>
        </FormField>
        */}
      </div>

      <FormField label="Temperament (optional)" htmlFor={id("temperament")}>
        <Select id={id("temperament")} value={values.temperament} onChange={(e) => onChange({ temperament: e.target.value })}>
          <option value="">Not specified</option>
          {TEMPERAMENTS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </Select>
      </FormField>

      <FormField label="Description (optional)" htmlFor={id("description")}>
        <TextArea id={id("description")} rows={3} value={values.description} onChange={(e) => onChange({ description: e.target.value })} />
      </FormField>
    </>
  );
}

interface PhotoFieldProps {
  idPrefix: string;
  label: string;
  file: File | null;
  onFileChange: (file: File | null) => void;
  /** URL of the photo the pet currently has (edit only). */
  currentUrl?: string | null;
  petName?: string;
}

/** File picker that previews the current photo, and the newly chosen one before saving. */
export function PhotoField({ idPrefix, label, file, onFileChange, currentUrl, petName }: PhotoFieldProps) {
  const previewUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const shown = previewUrl ?? currentUrl ?? null;

  return (
    <FormField label={label} htmlFor={`${idPrefix}-image`}>
      {shown ? (
        <div className="mb-2">
          <img
            src={shown}
            alt={previewUrl ? "New photo preview" : `Current photo of ${petName ?? "pet"}`}
            data-testid={`${idPrefix}-photo-preview`}
            className="h-32 w-32 rounded-lg border border-gray-200 object-cover"
          />
          <p className="mt-1 text-xs text-gray-500">{previewUrl ? "New photo — not saved yet" : "Current photo"}</p>
        </div>
      ) : currentUrl === undefined ? null : (
        <p className="mb-2 text-xs text-gray-500">No photo yet.</p>
      )}
      <input
        id={`${idPrefix}-image`}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
        className="block w-full text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-gray-100 file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-gray-200"
      />
    </FormField>
  );
}
