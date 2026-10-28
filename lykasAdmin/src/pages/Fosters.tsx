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
import FosterReportsModal from "../components/fosters/FosterReportsModal";
import { attentionReasons } from "../utils/fosterReports";

interface Foster {
  _id: string;
  pet: { _id?: string; name: string };
  fosterer: { _id?: string; displayName: string };
  startDate: string;
  expectedEndDate?: string;
  extendedDays?: number;
  status: string;
  weeklyReportsSubmitted: number;
  weeklyReportsRequired: number;
}

const MAX_EXTENSION_DAYS = 30;

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
  const [reportsFor, setReportsFor] = useState<Foster | null>(null);

  const loadPending = useCallback(() => {
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
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadPending();
  }, [loadPending]);
  useRealtime(["WeeklyFosterReport"], loadPending);

  // Finishing or extending an active placement.
  const [managing, setManaging] = useState<Foster | null>(null);
  const [outcome, setOutcome] = useState<"ADOPTED" | "RETURNED" | "EXTENDED">("EXTENDED");
  const [extensionDays, setExtensionDays] = useState("14");
  const [staffNotes, setStaffNotes] = useState("");
  const [missingReports, setMissingReports] = useState(0);
  const [manageError, setManageError] = useState<string | null>(null);
  const [managingSaving, setManagingSaving] = useState(false);

  const columns: Column<Foster>[] = [
    { key: "pet", header: "Pet", accessor: (f) => f.pet?.name },
    { key: "fosterer", header: "Fosterer", accessor: (f) => f.fosterer?.displayName },
    { key: "startDate", header: "Started", accessor: (f) => new Date(f.startDate).toLocaleDateString() },
    {
      key: "endsOn",
      header: "Ends",
      accessor: (f) =>
        f.expectedEndDate ? `${new Date(f.expectedEndDate).toLocaleDateString()}${f.extendedDays ? ` (+${f.extendedDays}d)` : ""}` : "—",
    },
    { key: "reports", header: "Weekly reports", accessor: (f) => `${f.weeklyReportsSubmitted}/${f.weeklyReportsRequired}` },
    {
      key: "toReview",
      header: "To review",
      accessor: (f) => {
        const entry = pending.get(f._id);
        if (!entry) return "—";
        return entry.attention ? (
          <StatusBadge status={`${entry.count} · needs attention`} tone="danger" />
        ) : (
          <StatusBadge status={`${entry.count} to review`} tone="warning" />
        );
      },
    },
    { key: "status", header: "Status", accessor: (f) => <StatusBadge status={f.status} /> },
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

  async function openManageModal(foster: Foster) {
    setManaging(foster);
    setOutcome("EXTENDED");
    setExtensionDays("14");
    setStaffNotes("");
    setManageError(null);
    setMissingReports(0);
    try {
      const res = await api.get(`/api/foster/${foster._id}/can-finalize`);
      setMissingReports(res.data.data?.missingReports ?? 0);
    } catch {
      /* the warning is optional; ending still works */
    }
  }

  async function submitManage(e: FormEvent) {
    e.preventDefault();
    if (!managing) return;
    const days = Number(extensionDays);
    const remaining = MAX_EXTENSION_DAYS - (managing.extendedDays ?? 0);
    if (outcome === "EXTENDED" && (!Number.isInteger(days) || days < 7 || days > remaining)) {
      setManageError(`Extend by 7 to ${remaining} days.`);
      return;
    }
    setManagingSaving(true);
    setManageError(null);
    try {
      await api.put(`/api/foster/${managing._id}/end`, {
        outcome,
        ...(outcome === "EXTENDED" ? { extensionDays: days } : {}),
        ...(staffNotes.trim() ? { staffNotes: staffNotes.trim() } : {}),
      });
      showToast(outcome === "EXTENDED" ? `Foster period extended by ${days} days` : "Foster placement completed", "success");
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

  return (
    <div>
      <PageHeader
        title="Foster Management"
        description="Active and past foster placements."
        actions={<Button onClick={openPlacementModal}><Plus className="h-4 w-4" aria-hidden="true" /> Start placement</Button>}
      />
      <DataTable
        columns={columns}
        rows={list.rows}
        rowKey={(f) => f._id}
        loading={list.loading}
        error={list.error}
        onRetry={list.reload}
        emptyTitle="No foster placements yet"
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
            {outcome === "EXTENDED" ? "Extend foster period" : "Complete placement"}
          </Button>
        </>}
      >
        <form id="manage-foster-placement" onSubmit={submitManage}>
          {manageError && <div className="mb-4"><Alert tone="danger">{manageError}</Alert></div>}
          {outcome !== "EXTENDED" && missingReports > 0 && (
            <div className="mb-4"><Alert tone="warning">{missingReports} weekly {missingReports === 1 ? "report is" : "reports are"} still missing for this placement.</Alert></div>
          )}
          <FormField label="What is happening?" htmlFor="foster-outcome">
            <Select id="foster-outcome" value={outcome} onChange={(e) => setOutcome(e.target.value as typeof outcome)}>
              <option value="EXTENDED">Extend the foster period</option>
              <option value="ADOPTED">Fosterer is adopting the pet</option>
              <option value="RETURNED">Pet is returned to the shelter</option>
            </Select>
          </FormField>
          {outcome === "EXTENDED" && (
            <FormField label="Extend by (days)" htmlFor="foster-extension">
              <Input
                id="foster-extension"
                type="number"
                min={7}
                max={MAX_EXTENSION_DAYS - (managing?.extendedDays ?? 0)}
                required
                value={extensionDays}
                onChange={(e) => setExtensionDays(e.target.value)}
              />
              <p className="mt-1 text-xs text-gray-500">
                Up to {MAX_EXTENSION_DAYS - (managing?.extendedDays ?? 0)} more days can be added. The pet stays with the fosterer and weekly reports continue.
              </p>
            </FormField>
          )}
          <FormField label="Notes (optional)" htmlFor="foster-notes">
            <TextArea id="foster-notes" rows={3} value={staffNotes} onChange={(e) => setStaffNotes(e.target.value)} />
          </FormField>
        </form>
      </Modal>
    </div>
  );
}
