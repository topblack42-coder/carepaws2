import { useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { useResourceList } from "../hooks/useResourceList";
import { api, getApiErrorMessage } from "../services/api";
import { PageHeader } from "../components/ui/SharedUI";
import DataTable, { type Column } from "../components/ui/DataTable";
import StatusBadge from "../components/ui/StatusBadge";
import Modal from "../components/ui/Modal";
import Button from "../components/ui/Button";
import Alert from "../components/ui/Alert";
import { FormField, Input, Select } from "../components/ui/FormUI";
import { useToast } from "../context/ToastContext";

interface Foster {
  _id: string;
  pet: { _id?: string; name: string };
  fosterer: { _id?: string; displayName: string };
  startDate: string;
  status: string;
  weeklyReportsSubmitted: number;
  weeklyReportsRequired: number;
}

interface FosterApplication {
  _id: string;
  applicant: { _id: string; displayName: string };
  pet: { _id: string; name: string };
  status: "approved";
  stage: "approved";
}

export default function Fosters() {
  const list = useResourceList<Foster>("/api/foster");
  const { showToast } = useToast();
  const [creating, setCreating] = useState(false);
  const [applications, setApplications] = useState<FosterApplication[]>([]);
  const [applicationId, setApplicationId] = useState("");
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [trialDurationDays, setTrialDurationDays] = useState("30");
  const [pickupDate, setPickupDate] = useState("");
  const [pickupMethod, setPickupMethod] = useState("Shelter pickup");
  const [pickupLocation, setPickupLocation] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const columns: Column<Foster>[] = [
    { key: "pet", header: "Pet", accessor: (f) => f.pet?.name },
    { key: "fosterer", header: "Fosterer", accessor: (f) => f.fosterer?.displayName },
    { key: "startDate", header: "Started", accessor: (f) => new Date(f.startDate).toLocaleDateString() },
    { key: "reports", header: "Weekly reports", accessor: (f) => `${f.weeklyReportsSubmitted}/${f.weeklyReportsRequired}` },
    { key: "status", header: "Status", accessor: (f) => <StatusBadge status={f.status} /> },
  ];

  async function openPlacementModal() {
    setError(null);
    setApplicationId("");
    setPickupDate("");
    setPickupMethod("Shelter pickup");
    setPickupLocation("");
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
    if (pickupDate && pickupMethod === "Home delivery" && !pickupLocation.trim()) {
      setError("A delivery address is required for home delivery.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.post("/api/foster", {
        application: application._id,
        pet: application.pet._id,
        fosterer: application.applicant._id,
        startDate: new Date(`${startDate}T00:00:00`).toISOString(),
        trialDurationDays: duration,
      });
      if (pickupDate) {
        try {
          await api.post("/api/adoption-pickups", {
            application: application._id,
            scheduledDate: pickupDate,
            method: pickupMethod,
            location: pickupLocation.trim() || undefined,
          });
          showToast("Foster placement started and pickup scheduled", "success");
        } catch (err) {
          showToast(`Placement started, but the pickup was not scheduled: ${getApiErrorMessage(err, "unknown error")}`, "error");
        }
      } else {
        showToast("Foster placement started", "success");
      }
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
      />

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
            <Select id="foster-application" required value={applicationId} onChange={(e) => setApplicationId(e.target.value)}>
              <option value="">Select an application</option>
              {applications.map((application) => (
                <option key={application._id} value={application._id}>
                  {application.applicant?.displayName} — {application.pet?.name}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Start date" htmlFor="foster-start-date">
            <Input id="foster-start-date" type="date" required value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </FormField>
          <FormField label="Trial duration (days)" htmlFor="foster-duration">
            <Input id="foster-duration" type="number" min={30} max={60} required value={trialDurationDays} onChange={(e) => setTrialDurationDays(e.target.value)} />
          </FormField>
          <p className="mb-2 mt-4 text-sm font-semibold text-gray-700">Pet pickup (optional)</p>
          <FormField label="Pickup date & time" htmlFor="foster-pickup-date">
            <Input id="foster-pickup-date" type="datetime-local" value={pickupDate} onChange={(e) => setPickupDate(e.target.value)} />
          </FormField>
          {pickupDate && (
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
    </div>
  );
}
