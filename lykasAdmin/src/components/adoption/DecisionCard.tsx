import { useState } from "react";
import { CheckCircle2, Info, XCircle } from "lucide-react";
import { Card } from "../ui/SharedUI";
import Button from "../ui/Button";
import ConfirmActionModal from "./ConfirmActionModal";
import { findLastEntry, formatDate, getEntryReason, type StageHistoryEntry } from "./applicationUtils";

interface DecisionCardProps {
  status: "pending" | "approved" | "rejected";
  type: "adoption" | "foster";
  petName: string;
  reviewedAt?: string | null;
  reviewedByName?: string;
  stageHistory: StageHistoryEntry[];
  /** Whether the final decision may be made now. */
  unlocked: boolean;
  /** Visible explanation shown while the decision is locked. */
  lockedReason: string;
  busy: boolean;
  onDecide: (status: "approved" | "rejected", note: string) => Promise<string | null>;
}

export default function DecisionCard({
  status,
  type,
  petName,
  reviewedAt,
  reviewedByName,
  stageHistory,
  unlocked,
  lockedReason,
  busy,
  onDecide,
}: DecisionCardProps) {
  const [mode, setMode] = useState<"approved" | "rejected" | null>(null);
  const petBecomes = type === "foster" ? "Foster" : "Adopted";

  if (status !== "pending") {
    const approved = status === "approved";
    const reason = getEntryReason(findLastEntry(stageHistory, status));
    return (
      <Card className="scroll-mt-4" >
        <h2 id="decision" className="mb-3 text-base font-semibold text-gray-900">Decision</h2>
        <div className={`rounded-lg border p-3 text-sm ${approved ? "border-primary/30 bg-status-successBg text-gray-900" : "border-status-danger/30 bg-status-dangerBg text-gray-900"}`}>
          <p className="flex items-center gap-2 font-semibold">
            {approved ? <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden="true" /> : <XCircle className="h-4 w-4 text-status-danger" aria-hidden="true" />}
            {approved ? "Approved" : "Rejected"}
            {reviewedAt ? ` on ${formatDate(reviewedAt)}` : ""}
            {reviewedByName ? ` by ${reviewedByName}` : ""}
          </p>
          <p className="mt-2 text-gray-700">
            <span className="font-medium">{approved ? "Note" : "Reason"}:</span> {reason ?? "No reason recorded."}
          </p>
        </div>
      </Card>
    );
  }

  const lockProps = unlocked
    ? {}
    : { "aria-disabled": true as const, title: lockedReason };

  return (
    <Card className="scroll-mt-4">
      <h2 id="decision" className="mb-3 text-base font-semibold text-gray-900">Decision</h2>
      {!unlocked && (
        <p className="mb-3 flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{lockedReason}</span>
        </p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          disabled={busy}
          {...lockProps}
          className="aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
          onClick={() => unlocked && setMode("approved")}
        >
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Approve
        </Button>
        <Button
          type="button"
          variant="danger"
          disabled={busy}
          {...lockProps}
          className="aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
          onClick={() => unlocked && setMode("rejected")}
        >
          <XCircle className="h-4 w-4" aria-hidden="true" /> Reject
        </Button>
      </div>
      {unlocked && (
        <p className="mt-2 text-sm text-gray-600">
          You will be asked to confirm. The applicant is notified of the decision.
        </p>
      )}

      {mode === "approved" && (
        <ConfirmActionModal
          title="Approve this application?"
          summary={
            <ul className="list-disc space-y-1 pl-5">
              <li>{petName} becomes <strong>{petBecomes}</strong>.</li>
              <li>The applicant is notified that the application was approved.</li>
            </ul>
          }
          noteLabel="Note to record"
          noteHelp="Optional. Saved in the stage history and sent to the applicant."
          confirmLabel="Approve application"
          onSubmit={(note) => onDecide("approved", note)}
          onClose={() => setMode(null)}
        />
      )}
      {mode === "rejected" && (
        <ConfirmActionModal
          title="Reject this application?"
          summary={
            <ul className="list-disc space-y-1 pl-5">
              <li>{petName} returns to <strong>Available</strong>.</li>
              <li>The applicant is notified and sees the reason you write below.</li>
              <li>This cannot be undone.</li>
            </ul>
          }
          noteLabel="Reason for rejection"
          noteHelp="At least 5 characters. The applicant will see this."
          requiredMinLength={5}
          confirmLabel="Reject application"
          variant="danger"
          onSubmit={(note) => onDecide("rejected", note)}
          onClose={() => setMode(null)}
        />
      )}
    </Card>
  );
}
