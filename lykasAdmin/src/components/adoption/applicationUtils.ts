import type { ApplicationStage } from "../../hooks/useApplications";

export type ApplicationType = "adoption" | "foster";

export interface StageHistoryEntry {
  stage: string;
  changedAt: string;
  note?: string;
  changedBy?: { displayName: string } | null;
}

export const STAGE_LABELS: Record<string, string> = {
  submitted: "Submitted",
  document_review: "Document review",
  interview: "Interview",
  home_visit: "Home visit",
  risk_assessment: "Risk assessment",
  approved: "Approved",
  adoption_scheduled: "Adoption scheduled",
  completed: "Completed",
  rejected: "Rejected",
};

export const stageLabel = (stage: string) => STAGE_LABELS[stage] ?? stage;

/** Main pipeline, in the same order the server enforces (STAGE_ORDER). "rejected" is not a step. */
const ADOPTION_STEPS: ApplicationStage[] = [
  "submitted",
  "document_review",
  "interview",
  "home_visit",
  "risk_assessment",
  "approved",
  "adoption_scheduled",
  "completed",
];

/** Foster applications end at "approved": placement is then started in Foster Management. */
const FOSTER_STEPS: ApplicationStage[] = ADOPTION_STEPS.slice(0, ADOPTION_STEPS.indexOf("approved") + 1);

export const getSteps = (type: ApplicationType): ApplicationStage[] => (type === "foster" ? FOSTER_STEPS : ADOPTION_STEPS);

/** Stages that may only be reached through PUT /status (applicant notification + audit entry). */
const DECISION_STAGES: ApplicationStage[] = ["approved", "rejected"];

export type StepState = "completed" | "current" | "next" | "upcoming" | "stopped";

export interface StepInfo {
  stage: ApplicationStage;
  state: StepState;
}

const isAutoNote = (entry: StageHistoryEntry) =>
  !entry.note ||
  entry.note === "Application submitted" ||
  entry.note === `Application moved to ${entry.stage}` ||
  entry.note === `Application ${entry.stage}`;

/** The reason staff typed for a stage change, or undefined when only the server's default text exists. */
export function getEntryReason(entry: StageHistoryEntry | undefined): string | undefined {
  return entry && !isAutoNote(entry) ? entry.note : undefined;
}

export function findLastEntry(history: StageHistoryEntry[] | undefined, stage: string): StageHistoryEntry | undefined {
  return (history ?? []).slice().reverse().find((entry) => entry.stage === stage);
}

/** The stage a rejected application was sitting at when it was rejected. */
export function getRejectedFromStage(history: StageHistoryEntry[] | undefined, fallback: ApplicationStage): ApplicationStage {
  const list = history ?? [];
  const rejectedAt = list.map((entry) => entry.stage).lastIndexOf("rejected");
  const previous = rejectedAt > 0 ? list[rejectedAt - 1].stage : undefined;
  return (previous as ApplicationStage | undefined) ?? fallback;
}

export function getStepStates(
  type: ApplicationType,
  stage: ApplicationStage,
  status: "pending" | "approved" | "rejected",
  history: StageHistoryEntry[] | undefined,
  rejectedFallback: ApplicationStage
): StepInfo[] {
  const steps = getSteps(type);
  const last = steps.length - 1;

  if (status === "rejected" || stage === "rejected") {
    const from = steps.indexOf(getRejectedFromStage(history, rejectedFallback));
    const stoppedAt = from < 0 ? steps.indexOf(rejectedFallback) : from;
    return steps.map((s, i) => ({ stage: s, state: i < stoppedAt ? "completed" : i === stoppedAt ? "stopped" : "upcoming" }));
  }

  const found = steps.indexOf(stage);
  const currentIndex = found < 0 ? last : found;
  // The very last step of a finished application is done, not "current".
  const finished = currentIndex === last && type === "adoption" && stage === "completed";

  return steps.map((s, i) => {
    let state: StepState;
    if (i < currentIndex || (i === currentIndex && finished)) state = "completed";
    else if (i === currentIndex) state = "current";
    else if (i === currentIndex + 1) state = "next";
    else state = "upcoming";
    return { stage: s, state };
  });
}

/**
 * The stage the "Next step" action moves to, or null when there is none through
 * PUT /stage: finished, rejected, or the next stage is a final decision.
 */
export function getAdvanceTarget(
  type: ApplicationType,
  stage: ApplicationStage,
  status: "pending" | "approved" | "rejected"
): ApplicationStage | null {
  if (status === "rejected") return null;
  const steps = getSteps(type);
  const index = steps.indexOf(stage);
  if (index < 0 || index >= steps.length - 1) return null;
  const next = steps[index + 1];
  return DECISION_STAGES.includes(next) ? null : next;
}

/** Admin page where the work for a stage is done. None of these pages read an application id from the URL. */
export const STAGE_WORK_LINKS: Partial<Record<ApplicationStage, { to: string; label: string }>> = {
  document_review: { to: "/documents", label: "Document Review" },
  interview: { to: "/interviews", label: "Interviews" },
  home_visit: { to: "/home-visits", label: "Home Visits" },
  risk_assessment: { to: "/risk-assessments", label: "Risk Assessments" },
  adoption_scheduled: { to: "/adoptions/scheduling", label: "Adoption Scheduling" },
};

export const formatDate = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString() : "");
export const formatDateTime = (iso?: string | null) => (iso ? new Date(iso).toLocaleString() : "");

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

export function formatRelative(iso: string, now = Date.now()): string {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  for (const [unit, size] of RELATIVE_UNITS) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
  }
  return "just now";
}
