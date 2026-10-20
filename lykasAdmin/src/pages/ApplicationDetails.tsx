import { useCallback, useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, CheckCircle2, ChevronRight, Clock, PawPrint, Phone, XCircle } from "lucide-react";
import { api, getApiErrorMessage } from "../services/api";
import { Card } from "../components/ui/SharedUI";
import { LoadingState, ErrorState } from "../components/ui/StateDisplays";
import StatusBadge from "../components/ui/StatusBadge";
import Button from "../components/ui/Button";
import TextArea from "../components/ui/TextArea";
import { useToast } from "../context/ToastContext";
import type { ApplicationStage } from "../hooks/useApplications";
import PipelineStepper from "../components/adoption/PipelineStepper";
import NextStepPanel from "../components/adoption/NextStepPanel";
import DecisionCard from "../components/adoption/DecisionCard";
import StageTimeline from "../components/adoption/StageTimeline";
import {
  findLastEntry,
  formatDate,
  formatDateTime,
  getAdvanceTarget,
  getEntryReason,
  getStepStates,
  getSteps,
  stageLabel,
  type StageHistoryEntry,
} from "../components/adoption/applicationUtils";

interface ApplicationDetail {
  _id: string;
  pet: { _id: string; name: string; species?: string; status?: string; imageUrl?: string | null };
  applicant: { _id: string; displayName: string; email: string };
  phone?: string;
  address?: string;
  experience?: string;
  householdSize?: number;
  isRenting?: boolean;
  landlordApproval?: boolean;
  type: "adoption" | "foster";
  fosterPeriod?: string;
  status: "pending" | "approved" | "rejected";
  stage: ApplicationStage;
  createdAt: string;
  reviewedAt?: string | null;
  reviewedBy?: { displayName: string } | null;
  stageHistory: StageHistoryEntry[];
  internalNotes?: { author?: { displayName: string }; text: string; createdAt: string }[];
}

/**
 * The server only accepts a final decision while the application sits at this
 * stage (updateStatus in applicationController.js). If that rule changes, this
 * is the only line to update here.
 */
const DECISION_UNLOCK_STAGE: ApplicationStage = "risk_assessment";
const isDecisionUnlocked = (app: Pick<ApplicationDetail, "status" | "stage">) =>
  app.status === "pending" && app.stage === DECISION_UNLOCK_STAGE;

const NOT_PROVIDED = "Not provided";

const CHIP_TONES = {
  success: "bg-status-successBg text-status-success",
  warning: "bg-amber-100 text-amber-900",
  danger: "bg-red-100 text-red-800",
  neutral: "bg-gray-100 text-gray-800",
} as const;

function Chip({ tone, children }: { tone: keyof typeof CHIP_TONES; children: ReactNode }) {
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ${CHIP_TONES[tone]}`}>{children}</span>;
}

function Field({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-wrap text-sm text-gray-900">{children}</dd>
    </div>
  );
}

const linkClasses =
  "rounded text-primary underline underline-offset-2 hover:text-primary/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

export default function ApplicationDetails() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { showToast } = useToast();
  const [application, setApplication] = useState<ApplicationDetail | null>(null);
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [noteSaving, setNoteSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cameFromList = (location.state as { fromList?: boolean } | null)?.fromList === true;
  const goBack = () => (cameFromList ? navigate(-1) : navigate("/adoptions"));

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.get(`/api/applications/${id}`);
      setApplication(res.data.data);
    } catch (err) {
      setError(getApiErrorMessage(err, "Failed to load application"));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  /** Moves exactly one pipeline stage. Final decisions never go through here. */
  async function advanceStage(stage: ApplicationStage, note: string): Promise<string | null> {
    if (!application) return "Application is not loaded.";
    if (stage === "approved" || stage === "rejected") return "Final decisions are made in the Decision card.";
    setSaving(true);
    try {
      const res = await api.put(`/api/applications/${application._id}/stage`, { stage, note: note || undefined });
      setApplication(res.data.data);
      showToast(`Moved to ${stageLabel(stage)}`, "success");
      return null;
    } catch (err) {
      return getApiErrorMessage(err, "Failed to update application stage");
    } finally {
      setSaving(false);
    }
  }

  /** The only path to approved/rejected: PUT /status notifies the applicant and writes the audit entry. */
  async function decide(status: "approved" | "rejected", note: string): Promise<string | null> {
    if (!application) return "Application is not loaded.";
    setSaving(true);
    try {
      const res = await api.put(`/api/applications/${application._id}/status`, { status, note: note || undefined });
      setApplication(res.data.data);
      showToast(`Application ${status}`, "success");
      return null;
    } catch (err) {
      return getApiErrorMessage(err, "Failed to update application status");
    } finally {
      setSaving(false);
    }
  }

  async function addNote() {
    if (!application || !notes.trim() || noteSaving) return;
    setNoteSaving(true);
    try {
      const res = await api.post(`/api/applications/${application._id}/notes`, { text: notes.trim() });
      setApplication((current) => (current ? { ...current, internalNotes: res.data.data } : current));
      setNotes("");
      showToast("Internal note added", "success");
    } catch (err) {
      showToast(getApiErrorMessage(err, "Failed to add note"), "error");
    } finally {
      setNoteSaving(false);
    }
  }

  function onNoteKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      addNote();
    }
  }

  if (loading) return <LoadingState label="Loading application…" />;
  if (error || !application) return <ErrorState message={error ?? "Application not found"} onRetry={load} />;

  const { pet, applicant } = application;
  const petName = pet?.name ?? "Pet";
  const typeLabel = application.type === "foster" ? "Foster" : "Adoption";
  const rejected = application.status === "rejected";
  const reviewerName = application.reviewedBy?.displayName;
  const rejectionReason = rejected ? getEntryReason(findLastEntry(application.stageHistory, "rejected")) : undefined;

  const steps = getStepStates(application.type, application.stage, application.status, application.stageHistory, DECISION_UNLOCK_STAGE);
  const advanceTarget = getAdvanceTarget(application.type, application.stage, application.status);

  const stageOrder = getSteps(application.type);
  const stepsToGo = Math.max(0, stageOrder.indexOf(DECISION_UNLOCK_STAGE) - stageOrder.indexOf(application.stage));
  const lockedReason = `Final decision unlocks after ${stageLabel(DECISION_UNLOCK_STAGE)}. Currently at: ${stageLabel(application.stage)} (${stepsToGo} step${stepsToGo === 1 ? "" : "s"} to go).`;

  const phoneHref = application.phone ? `tel:${application.phone.replace(/[^\d+]/g, "")}` : undefined;

  const statusTone = application.status === "approved" ? "success" : rejected ? "danger" : "warning";
  const StatusIcon = application.status === "approved" ? CheckCircle2 : rejected ? XCircle : Clock;

  // Below lg the actionable cards come first (order-*), from lg the original two columns apply.
  return (
    <div>
      <nav aria-label="Breadcrumb" className="mb-3">
        <ol className="flex flex-wrap items-center gap-1 text-sm text-gray-600">
          <li>
            <Link
              to="/adoptions"
              onClick={(e) => {
                e.preventDefault();
                goBack();
              }}
              className={linkClasses}
            >
              Adoption Applications
            </Link>
          </li>
          <li aria-hidden="true"><ChevronRight className="h-4 w-4" /></li>
          <li aria-current="page" className="font-medium text-gray-900">{petName}</li>
        </ol>
      </nav>

      <button
        type="button"
        onClick={goBack}
        className="mb-4 flex items-center gap-1.5 rounded text-sm text-gray-700 hover:text-gray-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to applications
      </button>

      <header className="mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold text-gray-900">{typeLabel} application: {petName}</h1>
          <Chip tone="neutral">{typeLabel}</Chip>
          <Chip tone={statusTone}>
            <StatusIcon className="h-4 w-4" aria-hidden="true" />
            <span className="capitalize">{application.status}</span>
          </Chip>
        </div>
        <p className="mt-1 text-sm text-gray-600">
          Submitted by {applicant?.displayName ?? "Unknown applicant"} on {formatDate(application.createdAt)}
          {application.reviewedAt && ` · Reviewed ${formatDate(application.reviewedAt)}${reviewerName ? ` by ${reviewerName}` : ""}`}
        </p>
      </header>

      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[1.2fr_.8fr] lg:items-start">
        <div className="contents lg:flex lg:flex-col lg:gap-4">
          <Card className="order-3 lg:order-none">
            <div className="flex gap-4">
              <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gray-100">
                {pet?.imageUrl ? (
                  <img src={pet.imageUrl} alt={petName} className="h-full w-full object-cover" />
                ) : (
                  <PawPrint className="h-8 w-8 text-gray-400" aria-label="No photo available" role="img" />
                )}
              </div>
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-gray-900">{petName}</h2>
                <p className="text-sm text-gray-700">{pet?.species ?? "Species not provided"}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="text-sm text-gray-600">Pet status:</span>
                  {pet?.status ? <StatusBadge status={pet.status} tone="neutral" /> : <span className="text-sm text-gray-700">{NOT_PROVIDED}</span>}
                </div>
                {pet?._id && (
                  <Link to={`/pets/${pet._id}`} className={`${linkClasses} mt-2 inline-block text-sm`}>
                    View {petName}'s page
                  </Link>
                )}
              </div>
            </div>
          </Card>

          <Card className="order-4 lg:order-none">
            <div className="mb-4">
              <h2 className="text-base font-semibold text-gray-900">{applicant.displayName}</h2>
              <p className="text-sm text-gray-600">Applied {formatDate(application.createdAt)}{application.reviewedAt && ` · Reviewed ${formatDate(application.reviewedAt)}`}</p>
            </div>

            <dl className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">
              <Field label="Email">
                <a href={`mailto:${applicant.email}`} className={linkClasses}>{applicant.email}</a>
              </Field>
              <Field label="Phone">
                {application.phone ? <a href={phoneHref} className={`${linkClasses} inline-flex items-center gap-1`}><Phone className="h-3.5 w-3.5" aria-hidden="true" />{application.phone}</a> : NOT_PROVIDED}
              </Field>
              <Field label="Address" wide>{application.address || NOT_PROVIDED}</Field>
              <Field label="Household size">{application.householdSize ?? NOT_PROVIDED}</Field>
              <Field label="Renting">{application.isRenting ? "Yes" : "No"}</Field>
              <Field label="Landlord approval">{application.isRenting ? (application.landlordApproval ? "Yes" : "No") : "N/A"}</Field>
              {application.type === "foster" && <Field label="Foster period">{application.fosterPeriod || NOT_PROVIDED}</Field>}
              <Field label="Experience" wide>{application.experience || NOT_PROVIDED}</Field>
            </dl>
          </Card>

          <Card className="order-1 lg:order-none">
            <h2 className="mb-4 text-base font-semibold text-gray-900">Pipeline</h2>
            {rejected && (
              <div className="mb-4 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-red-900">
                <XCircle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
                <div className="text-sm">
                  <p className="font-semibold">
                    Rejected{application.reviewedAt ? ` on ${formatDate(application.reviewedAt)}` : ""}
                    {reviewerName ? ` by ${reviewerName}` : ""}
                  </p>
                  <p className="mt-1">Reason: {rejectionReason ?? "No reason recorded."}</p>
                </div>
              </div>
            )}
            <PipelineStepper steps={steps} />
            <NextStepPanel
              type={application.type}
              stage={application.stage}
              status={application.status}
              petName={petName}
              advanceTarget={advanceTarget}
              busy={saving}
              onAdvance={advanceStage}
            />
          </Card>

          <Card className="order-5 lg:order-none">
            <h2 className="mb-4 text-base font-semibold text-gray-900">Stage history</h2>
            <StageTimeline history={application.stageHistory ?? []} />
          </Card>
        </div>

        <div className="contents lg:flex lg:flex-col lg:gap-4">
          <div className="order-2 lg:order-none">
            <DecisionCard
              status={application.status}
              type={application.type}
              petName={petName}
              reviewedAt={application.reviewedAt}
              reviewedByName={reviewerName}
              stageHistory={application.stageHistory ?? []}
              unlocked={isDecisionUnlocked(application)}
              lockedReason={lockedReason}
              busy={saving}
              onDecide={decide}
            />
          </div>

          <Card className="order-6 lg:order-none">
            <h2 className="mb-3 text-base font-semibold text-gray-900">Internal notes</h2>
            <div className="mb-3 space-y-2">
              {application.internalNotes?.length ? application.internalNotes.map((note, index) => (
                <div key={`${note.createdAt}-${index}`} className="rounded-lg bg-gray-50 px-3 py-2">
                  <p className="whitespace-pre-wrap text-sm text-gray-900">{note.text}</p>
                  <p className="mt-1 text-xs text-gray-600">{note.author?.displayName ?? "Staff"} · {formatDateTime(note.createdAt)}</p>
                </div>
              )) : <p className="text-sm text-gray-600">No internal notes yet.</p>}
            </div>
            <TextArea
              rows={4}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onKeyDown={onNoteKeyDown}
              aria-label="Add an internal note"
              aria-describedby="note-hint"
              placeholder="Add an internal note…"
            />
            <div className="mt-2 flex items-center justify-between gap-3">
              <p id="note-hint" className="text-xs text-gray-600">Press Ctrl/Cmd + Enter to add.</p>
              <Button type="button" onClick={addNote} loading={noteSaving} disabled={!notes.trim()}>
                Add note
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
