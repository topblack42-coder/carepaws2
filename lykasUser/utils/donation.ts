/** Quick-amount chips on Home (PHP). Must stay valid for `/donate`. */
export const QUICK_DONATION_AMOUNTS = [100, 250, 500, 1000] as const;

/** Shelter-editable impact copy shown under the quick-amount chips. */
export const DONATION_IMPACT_LINE = "₱250 feeds a dog for a week";

/** Short pitch shown at the top of the donation card. */
export const DONATION_MESSAGE = "Your donation feeds and cares for pets in our shelter.";

/** Parses the optional `amount` route param; returns null when absent or invalid. */
export function parseAmountParam(value: string | string[] | undefined): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}
