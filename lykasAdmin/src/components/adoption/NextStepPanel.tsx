import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, ExternalLink } from "lucide-react";
import Button from "../ui/Button";
import ConfirmActionModal from "./ConfirmActionModal";
import { STAGE_WORK_LINKS, stageLabel, type ApplicationType } from "./applicationUtils";
import type { ApplicationStage } from "../../hooks/useApplications";

interface NextStepPanelProps {
  type: ApplicationType;
  stage: ApplicationStage;
  status: "pending" | "approved" | "rejected";
  petName: string;
  /** Stage reachable through PUT /stage, or null when none (final decision, finished, rejected). */
  advanceTarget: ApplicationStage | null;
  busy: boolean;
  onAdvance: (stage: ApplicationStage, note: string) => Promise<string | null>;
}

const linkClasses =
  "inline-flex items-center gap-1 rounded text-sm font-medium text-primary underline underline-offset-2 hover:text-primary/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

export default function NextStepPanel({ type, stage, status, petName, advanceTarget, busy, onAdvance }: NextStepPanelProps) {
  const [confirming, setConfirming] = useState(false);

  if (status === "rejected") {
    return (
      <p className="text-sm text-gray-700">
        <span className="font-medium text-gray-900">No further steps.</span> This application was rejected and cannot re-enter the pipeline.
      </p>
    );
  }

  const workLink = STAGE_WORK_LINKS[stage] ?? (advanceTarget ? STAGE_WORK_LINKS[advanceTarget] : undefined);

  let body;
  if (type === "foster" && status === "approved") {
    body = (
      <>
        <p className="text-sm text-gray-700">
          <span className="font-medium text-gray-900">Approved.</span> The foster placement for {petName} is started in Foster Management.
        </p>
        <Link to="/fosters" className={`${linkClasses} mt-3`}>
          Start foster placement <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </>
    );
  } else if (advanceTarget) {
    body = (
      <>
        <p className="text-sm text-gray-700">
          <span className="font-medium text-gray-900">Current: {stageLabel(stage)}.</span> Next: {stageLabel(advanceTarget)}.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <Button type="button" onClick={() => setConfirming(true)} disabled={busy}>
            Move to {stageLabel(advanceTarget)}
          </Button>
          {workLink && (
            <Link to={workLink.to} className={linkClasses}>
              Where this stage is done: {workLink.label} <ExternalLink className="h-4 w-4" aria-hidden="true" />
            </Link>
          )}
        </div>
        {confirming && (
          <ConfirmActionModal
            title={`Move to ${stageLabel(advanceTarget)}`}
            summary={
              <p>
                {petName}'s application will move from <strong>{stageLabel(stage)}</strong> to <strong>{stageLabel(advanceTarget)}</strong>. The change
                is recorded in the stage history.
              </p>
            }
            noteLabel="Note"
            noteHelp="Saved with this stage change."
            confirmLabel={`Move to ${stageLabel(advanceTarget)}`}
            onSubmit={(note) => onAdvance(advanceTarget, note)}
            onClose={() => setConfirming(false)}
          />
        )}
      </>
    );
  } else if (status === "pending") {
    body = (
      <>
        <p className="text-sm text-gray-700">
          <span className="font-medium text-gray-900">Final decision required.</span> Approving or rejecting is done in the Decision card, not by moving a stage.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <a href="#decision" className={linkClasses}>
            Go to Decision <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </a>
          {workLink && (
            <Link to={workLink.to} className={linkClasses}>
              Where this stage is done: {workLink.label} <ExternalLink className="h-4 w-4" aria-hidden="true" />
            </Link>
          )}
        </div>
      </>
    );
  } else {
    body = (
      <p className="text-sm text-gray-700">
        <span className="font-medium text-gray-900">All steps complete.</span> There is nothing further to move.
      </p>
    );
  }

  return (
    <section aria-label="Next step" className="mt-5 rounded-lg border border-gray-200 bg-gray-50 p-4">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-600">Next step</h3>
      {body}
    </section>
  );
}
