import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import { api, getApiErrorMessage } from "../../services/api";
import { useToast } from "../../context/ToastContext";
import Modal from "../ui/Modal";
import Button from "../ui/Button";
import StatusBadge from "../ui/StatusBadge";
import TextArea from "../ui/TextArea";
import { LoadingState, ErrorState } from "../ui/StateDisplays";
import { attentionReasons, type FosterReport } from "../../utils/fosterReports";

interface Props {
  foster: { _id: string; pet?: { name: string }; fosterer?: { displayName: string }; weeklyReportsRequired: number } | null;
  onClose: () => void;
  /** Called after a report is reviewed so the list behind the modal can refresh. */
  onChanged: () => void;
}

const formatDate = (value?: string | null) => (value ? new Date(value).toLocaleDateString() : "—");

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-gray-900">{children || "—"}</dd>
    </div>
  );
}

export default function FosterReportsModal({ foster, onClose, onChanged }: Props) {
  const { showToast } = useToast();
  const [reports, setReports] = useState<FosterReport[]>([]);
  const [overdueWeeks, setOverdueWeeks] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openWeek, setOpenWeek] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const fosterId = foster?._id;

  const load = useCallback(
    async (initial: boolean) => {
      if (!fosterId) return;
      if (initial) {
        setLoading(true);
        setError(null);
      }
      try {
        const [reportsRes, missingRes] = await Promise.all([
          api.get(`/api/foster/${fosterId}/reports`),
          api.get(`/api/foster/${fosterId}/reports/missing`),
        ]);
        const list: FosterReport[] = reportsRes.data.data ?? [];
        setReports(list);
        setOverdueWeeks(missingRes.data.data?.overdueWeeks ?? []);
        if (initial) setOpenWeek(list.find((r) => r.status === "submitted" && !r.reviewedAt)?.weekNumber ?? null);
      } catch (err) {
        if (initial) setError(getApiErrorMessage(err, "Failed to load foster reports"));
      } finally {
        if (initial) setLoading(false);
      }
    },
    [fosterId]
  );

  useEffect(() => {
    setNote("");
    void load(true);
  }, [load]);

  const weeks = useMemo(() => {
    const byWeek = new Map(reports.map((r) => [r.weekNumber, r]));
    const required = foster?.weeklyReportsRequired ?? 0;
    return Array.from({ length: Math.max(required, ...reports.map((r) => r.weekNumber), 0) }, (_, i) => {
      const week = i + 1;
      const report = byWeek.get(week);
      const submitted = report?.status === "submitted" ? report : undefined;
      return { week, report: submitted, overdue: !submitted && overdueWeeks.includes(week) };
    });
  }, [reports, overdueWeeks, foster?.weeklyReportsRequired]);

  const submittedCount = weeks.filter((w) => w.report).length;
  const toReview = weeks.filter((w) => w.report && !w.report.reviewedAt).length;

  async function markReviewed(report: FosterReport) {
    setSaving(true);
    try {
      await api.put(`/api/foster/reports/${report._id}/review`, { adminNotes: note.trim() || undefined });
      showToast(`Week ${report.weekNumber} marked as reviewed`, "success");
      setNote("");
      await load(false);
      onChanged();
    } catch (err) {
      showToast(getApiErrorMessage(err, "Failed to mark the report as reviewed"), "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen={!!foster}
      onClose={onClose}
      title={`Weekly reports · ${foster?.pet?.name ?? ""}`}
      footer={<Button variant="secondary" onClick={onClose}>Close</Button>}
    >
      {loading ? (
        <LoadingState label="Loading reports…" />
      ) : error ? (
        <ErrorState message={error} onRetry={() => load(true)} />
      ) : (
        <div>
          <p className="mb-4 text-sm text-gray-600">
            {foster?.fosterer?.displayName ? `${foster.fosterer.displayName} · ` : ""}
            {submittedCount} of {weeks.length} submitted
            {toReview > 0 ? ` · ${toReview} to review` : ""}
          </p>

          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
            {weeks.map(({ week, report, overdue }) => {
              const reasons = report ? attentionReasons(report) : [];
              const isOpen = openWeek === week && !!report;
              return (
                <li key={week}>
                  <button
                    type="button"
                    disabled={!report}
                    onClick={() => {
                      setOpenWeek(isOpen ? null : week);
                      setNote("");
                    }}
                    aria-expanded={isOpen}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left enabled:hover:bg-gray-50 disabled:cursor-default"
                  >
                    {report ? (
                      isOpen ? <ChevronDown className="h-4 w-4 text-gray-400" aria-hidden="true" /> : <ChevronRight className="h-4 w-4 text-gray-400" aria-hidden="true" />
                    ) : (
                      <span className="h-4 w-4" />
                    )}
                    <span className="w-16 text-sm font-medium text-gray-900">Week {week}</span>
                    <span className="flex-1 text-xs text-gray-500">
                      {report ? `Submitted ${formatDate(report.submittedAt)}` : overdue ? "Past its due date" : "Not submitted yet"}
                    </span>
                    {reasons.length > 0 && (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-status-danger">
                        <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> Needs attention
                      </span>
                    )}
                    {report ? (
                      report.reviewedAt ? <StatusBadge status="reviewed" tone="success" /> : <StatusBadge status="needs review" tone="warning" />
                    ) : overdue ? (
                      <StatusBadge status="overdue" />
                    ) : (
                      <StatusBadge status="upcoming" tone="neutral" />
                    )}
                  </button>

                  {isOpen && report && (
                    <div className="border-t border-gray-100 bg-gray-50 px-4 py-4">
                      {reasons.length > 0 && (
                        <div className="mb-3 rounded-lg border border-status-danger/20 bg-status-dangerBg px-3 py-2 text-sm text-status-danger">
                          {reasons.join(" · ")}
                        </div>
                      )}
                      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
                        <Detail label="Weight change">{report.weightChange !== undefined ? `${report.weightChange > 0 ? "+" : ""}${report.weightChange}` : ""}</Detail>
                        <Detail label="Appetite">{report.appetite}</Detail>
                        <Detail label="Energy">{report.energy}</Detail>
                        <Detail label="Overall progress">{report.overallProgress}</Detail>
                        <Detail label="Vet visit required">{report.vetVisitRequired ? "Yes" : "No"}</Detail>
                        <Detail label="Submitted">{formatDate(report.submittedAt)}</Detail>
                      </dl>
                      <dl className="mt-3 space-y-3">
                        <Detail label="Behavior">{report.behavior}</Detail>
                        <Detail label="Health concerns">{report.healthConcerns}</Detail>
                        <Detail label="Notes">{report.notes}</Detail>
                      </dl>

                      {report.reviewedAt ? (
                        <div className="mt-4 rounded-lg bg-white p-3 text-sm">
                          <p className="text-xs text-gray-500">Reviewed {formatDate(report.reviewedAt)}</p>
                          <p className="mt-1 text-gray-800">{report.adminNotes || "No review note."}</p>
                        </div>
                      ) : (
                        <div className="mt-4">
                          <label htmlFor={`review-note-${report._id}`} className="mb-1 block text-sm font-medium text-gray-700">
                            Review note (optional, shared with the fosterer)
                          </label>
                          <TextArea id={`review-note-${report._id}`} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
                          <div className="mt-2 flex justify-end">
                            <Button loading={saving} onClick={() => markReviewed(report)}>Mark reviewed</Button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
            {weeks.length === 0 && <li className="px-4 py-6 text-center text-sm text-gray-500">No reports are expected for this placement.</li>}
          </ul>
        </div>
      )}
    </Modal>
  );
}
