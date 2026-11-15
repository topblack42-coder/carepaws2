/**
 * Shelter staff need a phone number and a home address to review adoption and
 * foster applications. These helpers tell the app when a user's profile
 * (Settings > Contact details) is missing them, so we can recommend filling
 * them in.
 */
export interface ProfileContact {
  phone?: string | null;
  address?: string | null;
}

export interface MissingProfileField {
  key: "phone" | "address";
  label: string;
}

/** Returns the important contact details that are still empty. */
export function getMissingProfileFields(user: ProfileContact | null | undefined): MissingProfileField[] {
  const missing: MissingProfileField[] = [];
  if (!user?.phone?.trim()) missing.push({ key: "phone", label: "phone number" });
  if (!user?.address?.trim()) missing.push({ key: "address", label: "home address" });
  return missing;
}

/** "phone number", "phone number and home address" */
export function formatMissingFields(missing: MissingProfileField[]): string {
  return missing.map((m) => m.label).join(" and ");
}
