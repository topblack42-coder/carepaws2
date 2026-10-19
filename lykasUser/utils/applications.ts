import { api } from "./api";

export interface ApplicationSummary {
  _id: string;
  pet: { name: string; imageUrl?: string | null };
  type: "adoption" | "foster";
  status: string;
  stage: string;
  createdAt: string;
}

/** Ordered pipeline the server moves an application through (`rejected` is terminal and sits outside it). */
export const STAGE_ORDER: readonly string[] = [
  "submitted",
  "document_review",
  "interview",
  "home_visit",
  "risk_assessment",
  "approved",
  "adoption_scheduled",
  "completed",
];

/** Max application cards shown on the Home screen. */
export const MAX_HOME_APPLICATIONS = 3;

/** Returns "Step N of M" data for a stage, or null for rejected/unknown stages. */
export function getStageProgress(stage: string): { step: number; total: number } | null {
  const index = STAGE_ORDER.indexOf(stage);
  if (index === -1) return null;
  return { step: index + 1, total: STAGE_ORDER.length };
}

/** GET /api/applications/my — shared by the Home screen and My Applications. */
export async function fetchMyApplications(): Promise<ApplicationSummary[]> {
  const res = await api.get("/api/applications/my");
  return res.data.data;
}
