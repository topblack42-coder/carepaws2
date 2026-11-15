import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { useResourceList } from "../hooks/useResourceList";
import { api, getApiErrorMessage } from "../services/api";
import { PageHeader } from "../components/ui/SharedUI";
import DataTable, { type Column } from "../components/ui/DataTable";
import StatusBadge from "../components/ui/StatusBadge";
import Modal from "../components/ui/Modal";
import Button from "../components/ui/Button";
import Alert from "../components/ui/Alert";
import TextArea from "../components/ui/TextArea";
import { FormField, Input, Select } from "../components/ui/FormUI";
import { useToast } from "../context/ToastContext";
import { useRealtime } from "../context/RealtimeContext";
import { useAuth } from "../context/AuthContext";
import FosterReportsModal from "../components/fosters/FosterReportsModal";
import { attentionReasons } from "../utils/fosterReports";

interface Foster {
  _id: string;
  pet: { _id?: string; name: string };
  fosterer: { _id?: string; displayName: string };
  startDate: string;
  expectedEndDate?: string;
  extendedDays?: number;
  extensions?: unknown[];
  returnRequest?: { urgency: "routine" | "emergency"; reason: string; status: "open" | "resolved" };
  status: string;
  weeklyReportsSubmitted: number;
  weeklyReportsRequired: number;
}

const MAX_EXTENSION_DAYS = 30;
const MIN_EXTENSION_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

type ManageMode = "EXTEND" | "ADOPTED" | "RETURNED";

interface Readiness {
  canFinalize: boolean;
  missingReports: number;
  unreviewedReports: number;
  requiresVetCheck: boolean;
  healthFlags: { weekNumber: number; reasons: string[] }[];
  returnRequest: { urgency: "routine" | "emergency"; reason: string } | null;
}

/** How close a placement is to its end date, for the list badge. Mirrors the server's alert stages. */
function endDateBadge(f: Foster): { label: string; tone: "danger" | "warning" } | null {
  if (f.status !== "active" || !f.expectedEndDate) return null;
  const ms = new Date(f.expectedEndDate).getTime() - Date.now();
  if (ms < 0) return { label: `Overdue ${Math.max(1, Math.floor(-ms / DAY_MS))}d`, tone: "danger" };
  const days = Math.ceil(ms / DAY_MS);
  return days <= 7 ? { label: days <= 1 ? "Ends tomorrow" : `Ends in ${days}d`, tone: "warning" } : null;
}

function extendedEndDate(value: string, days: number): string {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date.toLocaleDateString();
}

interface FosterApplication {
  _id: string;
  applicant: { _id: string; displayName: string };
  pet: { _id: string; name: string };
  status: "approved";
  stage: "approved";
  fosterDays?: number;
  fosterPeriod?: string;
  preferredPickupDate?: string;
  preferredPickupMethod?: "Shelter pickup" | "Home delivery";
}

export default function Fosters() {
  const list = useResourceList<Foster>("/api/foster");
  const { showToast } = useToast();
  const { hasRole } = useAuth();
  const isAdmin = hasRole("admin", "super_admin");
  const [creating, setCreating] = useState(false);
  const [applications, setApplications] = useState<FosterApplication[]>([]);
  const [applicationId, setApplicationId] = useState("");
  // Set when the chosen application already has a scheduled pickup; the foster period starts then.
  const [existingPickup, setExistingPickup] = useState<string | null>(null);
  const [trialDurationDays, setTrialDurationDays] = useState("30");
  const [pickupDate, setPickupDate] = useState("");
  const [pickupMethod, setPickupMethod] = useState("Shelter pickup");
  const [pickupLocation, setPickupLocation] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Which placements have reports waiting for staff, and whether any of them look worrying.
  const [pending, setPending] = useState<Map<string, { count: number; attention: boolean }>>(new Map());
  const [pendingLoading, setPendingLoading] = useState(true);
  const [pendingError, setPendingError] = useState<string | null>(null);
  const [overdueWeeks, setOverdueWeeks] = useState<Map<string, number | null>>(new Map());
  const [reportsFor, setReportsFor] = useState<Foster | null>(null);

  const loadPending = useCallback(() => {
    setPendingLoading(true);
    setPendingError(null);
    api
      .get("/api/foster/reports/pending-review")
      .then((res) => {
        const next = new Map<string, { count: number; attention: boolean }>();
        for (const report of res.data.data ?? []) {
          const id = String(report.foster?._id ?? report.foster);
          const entry = next.get(id) ?? { count: 0, attention: false };
          entry.count += 1;
          if (attentionReasons(report).length > 0) entry.attention = true;
          next.set(id, entry);
        }
        setPending(next);
        setPendingLoading(false);
      })
      .catch((err) => {
        setPendingError(getApiErrorMessage(err, "Could not load foster report alerts."));
        setPendingLoading(false);
      });
  }, []);

  useEffect(() => {
    loadPending();
  }, [loadPending]);
  useRealtime(["WeeklyFosterReport"], loadPending);

  useEffect(() => {
    let cancelled = false;
    const active = list.rows.filter((f) => f.status === "active");
    void Promise.all(active.map(async (f) => {
      try {
        const res = await api.get(`/api/foster/${f._id}/reports/missing`);
        return [f._id, (res.data.data?.overdueWeeks ?? []).length] as const;
      } catch {
        return [f._id, null] as const;
      }
    })).then((results) => {
      if (!cancelled) setOverdueWeeks(new Map(results));
    });
    return () => { cancelled = true; };
  }, [list.rows]);

  // Finishing or extending an active placement.
  const [managing, setManaging] = useState<Foster | null>(null);
  const [mode, setMode] = useState<ManageMode>("EXTEND");
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [readinessLoading, setReadinessLoading] = useState(false);
  const [readinessError, setReadinessError] = useState<string | null>(null);
  const [extensionDays, setExtensionDays] = useState("14");
  const [extensionReason, setExtensionReason] = useState("");
  const [vetAgreed, setVetAgreed] = useState(false);
  const [vetNotes, setVetNotes] = useState("");
  const [fostererAgreed, setFostererAgreed] = useState(false);
  const [healthNotes, setHealthNotes] = useState("");
  const [vetVerified, setVetVerified] = useState(false);
  const [exceptionReason, setExceptionReason] = useState("");
  const [staffNotes, setStaffNotes] = useState("");
  const [closureConfirmed, setClosureConfirmed] = useState(false);
  const [manageError, setManageError] = useState<string | null>(null);
  const [managingSaving, setManagingSaving] = useState(false);

  const columns: Column<Foster>[] = [
    { key: "pet", header: "Pet", accessor: (f) => f.pet?.name },
    { key: "fosterer", header: "Fosterer", accessor: (f) => f.fosterer?.displayName },
    { key: "startDate", header: "Started", accessor: (f) => new Date(f.startDate).toLocaleDateString() },
    {
      key: "endsOn",
      header: "Ends",
      accessor: (f) => {
        const badge = endDateBadge(f);
        const date = f.expectedEndDate ? `${new Date(f.expectedEndDate).toLocaleDateString()}${f.extendedDays ? ` (+${f.extendedDays}d)` : ""}` : "—";
        return badge ? (
          <span className="flex flex-wrap items-center gap-2">{date} <StatusBadge status={badge.label} tone={badge.tone} /></span>
        ) : (
          date
        );
      },
    },
    { key: "reports", header: "Weekly reports", accessor: (f) => (
      <div>
        <span>{f.weeklyReportsSubmitted}/{f.weeklyReportsRequired} submitted</span>
        {f.status === "active" && overdueWeeks.has(f._id) && (
          <div className="mt-1">
            {overdueWeeks.get(f._id) === null ? (
              <span className="text-xs text-status-danger">Overdue status unavailable</span>
            ) : overdueWeeks.get(f._id)! > 0 ? (
              <StatusBadge status={`${overdueWeeks.get(f._id)} overdue`} tone="danger" />
            ) : null}
          </div>
        )}
      </div>
    ) },
    {
      key: "toReview",
      header: "To review",
      accessor: (f) => {
        const entry = pending.get(f._id);
        if (pendingLoading) return "Loading…";
        if (pendingError) return <span className="text-status-danger">Unavailable</span>;
        if (!entry) return "—";
        return entry.attention ? (
          <StatusBadge status={`${entry.count} · needs attention`} tone="danger" />
        ) : (
          <StatusBadge status={`${entry.count} to review`} tone="warning" />
        );
      },
    },
    {
      key: "status",
      header: "Status",
      accessor: (f) =>
        f.status === "active" && f.returnRequest?.status === "open" ? (
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={f.status} />
            <StatusBadge status={f.returnRequest.urgency === "emergency" ? "Emergency return" : "Return requested"} tone={f.returnRequest.urgency === "emergency" ? "danger" : "warning"} />
          </span>
        ) : (
          <StatusBadge status={f.status} />
        ),
    },
  ];

  async function openPlacementModal() {
    setError(null);
    setApplicationId("");
    setPickupDate("");
    setPickupMethod("Shelter pickup");
    setPickupLocation("");
    setExistingPickup(null);
    try {
      const res = await api.get("/api/applications", {
        params: { status: "approved", stage: "approved", type: "foster", limit: 100 },
      });
      setApplications(res.data.data || []);
      setCreating(true);
    } catch (err) {
      showToast(getApiErrorMessage(err, "Failed to load approved foster applications"), "error");
    }
  }

  const selectedApplication = applications.find((item) => item._id === applicationId);

  function selectApplication(id: string) {
    setApplicationId(id);
    setExistingPickup(null);
    const application = applications.find((item) => item._id === id);
    if (!application) return;
    if (application.fosterDays && application.fosterDays >= 30 && application.fosterDays <= 60) setTrialDurationDays(String(application.fosterDays));
    // Prefill the pickup with what the applicant asked for (10:00 until staff adjust it).
    setPickupDate(application.preferredPickupDate ? `${application.preferredPickupDate.slice(0, 10)}T10:00` : "");
    setPickupMethod(application.preferredPickupMethod ?? "Shelter pickup");
    // A pickup may already be booked (e.g. from an earlier attempt): reuse it instead of double-booking.
    api
      .get("/api/adoption-pickups")
      .then((res) => {
        const booked = (res.data.data || []).find(
          (p: { application: string; status: string; scheduledDate: string }) => String(p.application) === id && p.status === "scheduled"
        );
        setExistingPickup(booked?.scheduledDate ?? null);
      })
      .catch(() => {});
  }

  async function refreshReadiness(foster: Foster) {
    setReadinessError(null);
    setReadinessLoading(true);
    try {
      const res = await api.get(`/api/foster/${foster._id}/can-finalize`);
      setReadiness(res.data.data ?? null);
    } catch (err) {
      setReadinessError(getApiErrorMessage(err, "Could not load placement checks."));
    } finally {
      setReadinessLoading(false);
    }
  }

  async function openManageModal(foster: Foster) {
    setManaging(foster);
    setMode(foster.returnRequest?.status === "open" ? "RETURNED" : "EXTEND");
    setExtensionDays("14");
    setExtensionReason("");
    setVetAgreed(false);
    setVetNotes("");
    setFostererAgreed(false);
    setHealthNotes("");
    setVetVerified(false);
    setExceptionReason("");
    setStaffNotes("");
    setClosureConfirmed(false);
    setManageError(null);
    setReadiness(null);
    await refreshReadiness(foster);
  }

  async function submitManage(e: FormEvent) {
    e.preventDefault();
    if (!managing) return;
    setManageError(null);
    if (readinessLoading || !readiness) {
      setManageError("Load the placement checks before continuing.");
      return;
    }

    if (mode === "EXTEND") {
      const days = Number(extensionDays);
      const remaining = MAX_EXTENSION_DAYS - (managing.extendedDays ?? 0);
      if (!Number.isInteger(days) || days < MIN_EXTENSION_DAYS || days > remaining) {
        setManageError(`Extend by ${MIN_EXTENSION_DAYS} to ${remaining} days.`);
        return;
      }
      if (extensionReason.trim().length < 10) {
        setManageError("Explain why the extension is needed (at least 10 characters).");
        return;
      }
      if (!fostererAgreed) {
        setManageError("The fosterer must agree to the extension.");
        return;
      }
    } else {
      if (healthNotes.trim().length < 10) {
        setManageError("Record the health check you did (at least 10 characters). Weekly reports alone do not prove the pet is healthy.");
        return;
      }
      if (readiness?.requiresVetCheck && !vetVerified) {
        setManageError("A weekly report raised a health concern. A veterinarian must check the pet first.");
        return;
      }
      if (needsException && exceptionReason.trim().length < 10) {
        setManageError("Some reports are missing or unreviewed. Review them, or have an admin record the reason for an exception.");
        return;
      }
    }

    if (mode !== "EXTEND" && !closureConfirmed) {
      setClosureConfirmed(true);
      return;
    }

    setManagingSaving(true);
    try {
      if (mode === "EXTEND") {
        const days = Number(extensionDays);
        await api.put(`/api/foster/${managing._id}/extend`, {
          extensionDays: days,
          reason: extensionReason.trim(),
          vetAgreed,
          fostererAgreed,
          ...(vetNotes.trim() ? { vetNotes: vetNotes.trim() } : {}),
        });
        showToast(`Foster period extended by ${days} days`, "success");
      } else {
        await api.put(`/api/foster/${managing._id}/end`, {
          outcome: mode,
          finalHealthCheck: { notes: healthNotes.trim(), vetVerified },
          ...(needsException && exceptionReason.trim() ? { completionException: { reason: exceptionReason.trim() } } : {}),
          ...(staffNotes.trim() ? { staffNotes: staffNotes.trim() } : {}),
        });
        showToast("Foster placement completed", "success");
      }
      setManaging(null);
      list.reload();
    } catch (err) {
      setManageError(getApiErrorMessage(err, "Failed to update foster placement"));
    } finally {
      setManagingSaving(false);
    }
  }

  async function createPlacement(e: FormEvent) {
    e.preventDefault();
    const application = applications.find((item) => item._id === applicationId);
    if (!application) {
      setError("Select an approved foster application.");
      return;
    }
    const duration = Number(trialDurationDays);
    if (!Number.isInteger(duration) || duration < 30 || duration > 60) {
      setError("Foster trial duration must be between 30 and 60 days.");
      return;
    }
    if (!existingPickup && !pickupDate) {
      setError("Choose the pickup date: the foster period starts when the pet is handed over.");
      return;
    }
    if (!existingPickup && pickupMethod === "Home delivery" && !pickupLocation.trim()) {
      setError("A delivery address is required for home delivery.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // Book the pickup first: the placement can only start once there is one,
      // and its start date is the handover date.
      let handover = existingPickup;
      if (!handover) {
        const created = await api.post("/api/adoption-pickups", {
          application: application._id,
          scheduledDate: new Date(pickupDate).toISOString(),
          method: pickupMethod,
          location: pickupLocation.trim() || undefined,
        });
        handover = created.data.data.scheduledDate as string;
      }
      await api.post("/api/foster", {
        application: application._id,
        pet: application.pet._id,
        fosterer: application.applicant._id,
        startDate: new Date(handover).toISOString(),
        trialDurationDays: duration,
      });
      showToast("Foster placement started and pickup scheduled", "success");
      setCreating(false);
      list.reload();
    } catch (err) {
      setError(getApiErrorMessage(err, "Failed to start foster placement"));
    } finally {
      setSaving(false);
    }
  }

  // Reports missing or unreviewed block completion; an open emergency return waives the check.
  const reportsIncomplete = !!readiness && (readiness.missingReports > 0 || readiness.unreviewedReports > 0);
  const emergencyReturn = mode === "RETURNED" && readiness?.returnRequest?.urgency === "emergency";
  const needsException = reportsIncomplete && !emergencyReturn;

  return (
    <div>
      <PageHeader
        title="Foster Management"
        description="Active and past foster placements."
        actions={<Button onClick={openPlacementModal}><Plus className="h-4 w-4" aria-hidden="true" /> Start placement</Button>}
      />
      {pendingError && (
        <div className="mb-4"><Alert tone="danger">
          <span>{pendingError} Report counts may be out of date. </span>
          <button type="button" className="font-semibold underline" onClick={loadPending}>Retry</button>
        </Alert></div>
      )}
      <DataTable
        columns={columns}
        rows={list.rows}
        rowKey={(f) => f._id}
        loading={list.loading}
        error={list.error}
        onRetry={list.reload}
        emptyTitle="No foster placements yet"
        emptyDescription="Try changing your search or status filter, or start a placement from an approved foster application."
        searchValue={list.search}
        onSearchChange={list.onSearchChange}
        filters={[{ key: "status", label: "Status", options: [{ value: "active", label: "Active" }, { value: "completed", label: "Completed" }, { value: "cancelled", label: "Cancelled" }] }]}
        filterValues={list.filters}
        onFilterChange={list.onFilterChange}
        page={list.pagination.page}
        pages={list.pagination.pages}
        total={list.pagination.total}
        onPageChange={list.setPage}
        rowActions={(f) => (
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setReportsFor(f)}>
              View reports
            </Button>
            {f.status === "active" && (
              <Button variant="secondary" onClick={() => openManageModal(f)}>
                Complete / extend
              </Button>
            )}
          </div>
        )}
      />

      <FosterReportsModal foster={reportsFor} onClose={() => setReportsFor(null)} onChanged={loadPending} />

      <Modal
        isOpen={creating}
        onClose={() => setCreating(false)}
        title="Start foster placement"
        footer={<>
          <Button variant="secondary" onClick={() => setCreating(false)} disabled={saving}>Cancel</Button>
          <Button type="submit" form="create-foster-placement" loading={saving}>Start placement</Button>
        </>}
      >
        <form id="create-foster-placement" onSubmit={createPlacement}>
          {error && <div className="mb-4"><Alert tone="danger">{error}</Alert></div>}
          <FormField label="Approved foster application" htmlFor="foster-application">
            <Select id="foster-application" required value={applicationId} onChange={(e) => selectApplication(e.target.value)}>
              <option value="">Select an application</option>
              {applications.map((application) => (
                <option key={application._id} value={application._id}>
                  {application.applicant?.displayName} — {application.pet?.name}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Trial duration (days)" htmlFor="foster-duration">
            <Input id="foster-duration" type="number" min={30} max={60} required value={trialDurationDays} onChange={(e) => setTrialDurationDays(e.target.value)} />
          </FormField>
          {selectedApplication && (
            <p className="-mt-2 mb-3 text-xs text-gray-500">
              {selectedApplication.fosterDays
                ? `Applicant offered ${selectedApplication.fosterDays} days.`
                : selectedApplication.fosterPeriod
                  ? `Applicant wrote: "${selectedApplication.fosterPeriod}". Choose 30–60 days.`
                  : "Applicant did not state a period."}
            </p>
          )}
          <p className="mb-2 mt-4 text-sm font-semibold text-gray-700">Pet pickup</p>
          {selectedApplication?.preferredPickupDate && !existingPickup && (
            <p className="mb-2 text-xs text-gray-500">
              Applicant requested {new Date(selectedApplication.preferredPickupDate).toLocaleDateString(undefined, { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" })}
              {selectedApplication.preferredPickupMethod ? ` · ${selectedApplication.preferredPickupMethod}` : ""}.
            </p>
          )}
          {existingPickup ? (
            <Alert tone="info">A pickup is already scheduled for {new Date(existingPickup).toLocaleString()}. The foster period starts then.</Alert>
          ) : (
            <FormField label="Pickup date & time (the foster period starts then)" htmlFor="foster-pickup-date">
              <Input id="foster-pickup-date" type="datetime-local" required value={pickupDate} onChange={(e) => setPickupDate(e.target.value)} />
            </FormField>
          )}
          {!existingPickup && pickupDate && (
            <>
              <FormField label="Method" htmlFor="foster-pickup-method">
                <Select id="foster-pickup-method" value={pickupMethod} onChange={(e) => setPickupMethod(e.target.value)}>
                  <option value="Shelter pickup">Shelter pickup</option>
                  <option value="Home delivery">Home delivery</option>
                </Select>
              </FormField>
              <FormField label={pickupMethod === "Home delivery" ? "Delivery address" : "Location (defaults to the shelter)"} htmlFor="foster-pickup-location">
                <Input id="foster-pickup-location" value={pickupLocation} onChange={(e) => setPickupLocation(e.target.value)} />
              </FormField>
            </>
          )}
        </form>
      </Modal>
      <Modal
        isOpen={!!managing}
        onClose={() => setManaging(null)}
        title={`Foster placement · ${managing?.pet?.name ?? ""}`}
        footer={<>
          <Button variant="secondary" onClick={() => setManaging(null)} disabled={managingSaving}>Cancel</Button>
          <Button type="submit" form="manage-foster-placement" loading={managingSaving}>
            {mode === "EXTEND" ? "Extend foster period" : closureConfirmed ? "Confirm placement closure" : "Review placement closure"}
          </Button>
        </>}
      >
        <form id="manage-foster-placement" onSubmit={submitManage}>
          {manageError && <div className="mb-4"><Alert tone="danger">{manageError}</Alert></div>}
          {readinessLoading && <div className="mb-4"><Alert tone="info">Checking reports and health alerts…</Alert></div>}
          {readinessError && <div className="mb-4"><Alert tone="danger">
            <span>{readinessError} </span>
            <button type="button" className="font-semibold underline" onClick={() => managing && void refreshReadiness(managing)}>Retry</button>
          </Alert></div>}
          {readiness?.returnRequest && (
            <div className="mb-4">
              <Alert tone={readiness.returnRequest.urgency === "emergency" ? "danger" : "warning"}>
                {readiness.returnRequest.urgency === "emergency" ? "Emergency return requested" : "Return requested"}: {readiness.returnRequest.reason}
              </Alert>
            </div>
          )}
          {reportsIncomplete && (
            <div className="mb-4">
              <Alert tone="warning">
                {readiness!.missingReports > 0 && `${readiness!.missingReports} weekly ${readiness!.missingReports === 1 ? "report is" : "reports are"} missing. `}
                {readiness!.unreviewedReports > 0 && `${readiness!.unreviewedReports} ${readiness!.unreviewedReports === 1 ? "report has" : "reports have"} not been reviewed. `}
                Use "View reports" to review them first.
              </Alert>
            </div>
          )}
          {readiness?.requiresVetCheck && (
            <div className="mb-4">
              <Alert tone="danger">
                A weekly report raised a health concern (week {readiness.healthFlags.map((f) => f.weekNumber).join(", ")}). A veterinarian must agree before you extend or complete.
              </Alert>
            </div>
          )}
          {closureConfirmed && mode !== "EXTEND" && (
            <div className="mb-4"><Alert tone="warning">
              Confirm closure: {managing?.pet?.name ?? "This pet"} will leave the foster placement. Outcome: {mode === "ADOPTED" ? "adopted by the fosterer" : "returned to the shelter"}. Review the health check and notes, then confirm below.
            </Alert></div>
          )}
          <FormField label="What is happening?" htmlFor="foster-outcome">
            <Select id="foster-outcome" value={mode} onChange={(e) => { setMode(e.target.value as ManageMode); setClosureConfirmed(false); }}>
              <option value="EXTEND">Extend the foster period</option>
              <option value="ADOPTED">Fosterer is adopting the pet</option>
              <option value="RETURNED">Pet is returned to the shelter</option>
            </Select>
          </FormField>

          {mode === "EXTEND" ? (
            <>
              <FormField label="Extend by (days)" htmlFor="foster-extension">
                <Input
                  id="foster-extension"
                  type="number"
                  min={MIN_EXTENSION_DAYS}
                  max={MAX_EXTENSION_DAYS - (managing?.extendedDays ?? 0)}
                  required
                  value={extensionDays}
                  onChange={(e) => setExtensionDays(e.target.value)}
                />
                <p className="mt-1 text-xs text-gray-500">
                  {MIN_EXTENSION_DAYS} to {MAX_EXTENSION_DAYS - (managing?.extendedDays ?? 0)} days. The pet stays with the fosterer, stays in foster care, and weekly reports continue.
                </p>
                  {managing?.expectedEndDate && Number(extensionDays) > 0 && (
                    <p className="mt-1 text-sm font-medium text-gray-800">
                      Current end date: {new Date(managing.expectedEndDate).toLocaleDateString()} · New end date: {extendedEndDate(managing.expectedEndDate, Number(extensionDays))}
                    </p>
                  )}
              </FormField>
              <FormField label="Why is an extension needed?" htmlFor="foster-extension-reason">
                <TextArea id="foster-extension-reason" rows={3} required value={extensionReason} onChange={(e) => setExtensionReason(e.target.value)} />
              </FormField>
              <label className="mb-2 flex items-start gap-2 text-sm text-gray-800">
                <input type="checkbox" className="mt-0.5" checked={fostererAgreed} onChange={(e) => setFostererAgreed(e.target.checked)} />
                The fosterer agreed to the extension
              </label>
              <label className="mb-2 flex items-start gap-2 text-sm text-gray-800">
                <input type="checkbox" className="mt-0.5" checked={vetAgreed} onChange={(e) => setVetAgreed(e.target.checked)} />
                A veterinarian agreed to the extension
              </label>
              {vetAgreed && (
                <FormField label="Vet notes (optional)" htmlFor="foster-vet-notes">
                  <TextArea id="foster-vet-notes" rows={2} value={vetNotes} onChange={(e) => setVetNotes(e.target.value)} />
                </FormField>
              )}
              <p className="text-xs text-gray-500">Recorded under your name as the person who authorized the extension. All due weekly reports must be submitted and reviewed first.</p>
            </>
          ) : (
            <>
              <FormField label="Health check you did on the pet" htmlFor="foster-health-notes">
                <TextArea id="foster-health-notes" rows={3} required value={healthNotes} onChange={(e) => setHealthNotes(e.target.value)} />
                <p className="mt-1 text-xs text-gray-500">Weekly reports are the fosterer's own account. Record what staff or a vet saw in person.</p>
              </FormField>
              <label className="mb-3 flex items-start gap-2 text-sm text-gray-800">
                <input type="checkbox" className="mt-0.5" checked={vetVerified} onChange={(e) => setVetVerified(e.target.checked)} />
                A veterinarian checked the pet
              </label>
              {needsException && (
                isAdmin ? (
                  <FormField label="Admin exception: why complete with missing or unreviewed reports?" htmlFor="foster-exception">
                    <TextArea id="foster-exception" rows={2} value={exceptionReason} onChange={(e) => setExceptionReason(e.target.value)} />
                  </FormField>
                ) : (
                  <div className="mb-3"><Alert tone="info">Only an admin can complete a placement with missing or unreviewed reports. Review the reports, or ask an admin.</Alert></div>
                )
              )}
              {emergencyReturn && reportsIncomplete && (
                <div className="mb-3"><Alert tone="info">This is an emergency return, so the report check is waived and the reason is recorded.</Alert></div>
              )}
              <FormField label="Notes (optional)" htmlFor="foster-notes">
                <TextArea id="foster-notes" rows={2} value={staffNotes} onChange={(e) => setStaffNotes(e.target.value)} />
              </FormField>
            </>
          )}
        </form>
      </Modal>
    </div>
  );
}
