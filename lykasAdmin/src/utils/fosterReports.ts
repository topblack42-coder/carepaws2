export interface FosterReport {
  _id: string;
  weekNumber: number;
  status: "missing" | "overdue" | "submitted";
  dueDate?: string | null;
  submittedAt?: string | null;
  weightChange?: number;
  appetite?: string;
  energy?: string;
  behavior?: string;
  healthConcerns?: string;
  vetVisitRequired?: boolean;
  overallProgress?: string;
  notes?: string;
  reviewedAt?: string | null;
  adminNotes?: string;
}

type ReportSignals = Pick<FosterReport, "vetVisitRequired" | "healthConcerns" | "overallProgress" | "appetite" | "energy">;

/** Why a report should get a closer look. Empty means nothing stands out. */
export function attentionReasons(report: ReportSignals): string[] {
  const reasons: string[] = [];
  if (report.vetVisitRequired) reasons.push("Vet visit required");
  if (report.healthConcerns?.trim()) reasons.push("Health concerns reported");
  if (report.overallProgress === "Needs Attention") reasons.push("Progress needs attention");
  if (report.appetite === "Poor") reasons.push("Poor appetite");
  if (report.energy === "Lethargic") reasons.push("Lethargic");
  return reasons;
}
