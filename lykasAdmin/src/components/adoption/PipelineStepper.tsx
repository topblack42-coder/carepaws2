import { Check, X } from "lucide-react";
import { stageLabel, type StepInfo, type StepState } from "./applicationUtils";

const STATE_TEXT: Record<StepState, string> = {
  completed: "Completed",
  current: "Current",
  next: "Next",
  upcoming: "Upcoming",
  stopped: "Rejected here",
};

const MARKER_CLASSES: Record<StepState, string> = {
  completed: "border-primary bg-primary text-white",
  current: "border-primary bg-primary text-white ring-4 ring-primary/20",
  next: "border-primary bg-white text-primary",
  upcoming: "border-gray-300 bg-white text-gray-600",
  stopped: "border-status-danger bg-status-danger text-white",
};

const TEXT_CLASSES: Record<StepState, string> = {
  completed: "text-gray-900",
  current: "font-semibold text-gray-900",
  next: "text-gray-900",
  upcoming: "text-gray-600",
  stopped: "font-semibold text-status-danger",
};

/** Read-only, ordered view of the pipeline: vertical on small screens, horizontal from lg. */
export default function PipelineStepper({ steps }: { steps: StepInfo[] }) {
  return (
    <div className="lg:overflow-x-auto lg:pb-1">
      <ol aria-label="Application pipeline" className="flex flex-col gap-0 lg:min-w-max lg:flex-row lg:gap-2">
        {steps.map((step, index) => (
          <li
            key={step.stage}
            aria-current={step.state === "current" ? "step" : undefined}
            className="flex items-start gap-3 lg:w-32 lg:flex-col lg:items-center lg:text-center"
          >
            <div className="flex flex-col items-center lg:w-full lg:flex-row">
              <span
                aria-hidden="true"
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-sm font-semibold ${MARKER_CLASSES[step.state]}`}
              >
                {step.state === "completed" ? (
                  <Check className="h-4 w-4" />
                ) : step.state === "stopped" ? (
                  <X className="h-4 w-4" />
                ) : (
                  index + 1
                )}
              </span>
              {index < steps.length - 1 && (
                <span
                  aria-hidden="true"
                  className={`my-1 h-6 w-0.5 lg:mx-1 lg:my-0 lg:h-0.5 lg:w-auto lg:flex-1 ${
                    step.state === "completed" ? "bg-primary" : "bg-gray-300"
                  }`}
                />
              )}
            </div>
            <div className="pb-2 lg:pb-0">
              <p className={`text-sm ${TEXT_CLASSES[step.state]}`}>{stageLabel(step.stage)}</p>
              <p className="text-xs text-gray-600">{STATE_TEXT[step.state]}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
