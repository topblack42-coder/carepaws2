import { useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { useApplications } from "../hooks/useApplications";
import { useResourceList } from "../hooks/useResourceList";
import { api, getApiErrorMessage } from "../services/api";
import { PageHeader, Card } from "../components/ui/SharedUI";
import { LoadingState, ErrorState, EmptyState } from "../components/ui/StateDisplays";
import StatusBadge from "../components/ui/StatusBadge";
import DataTable, { type Column } from "../components/ui/DataTable";
import Modal from "../components/ui/Modal";
import Button from "../components/ui/Button";
import Alert from "../components/ui/Alert";
import TextArea from "../components/ui/TextArea";
import { FormField, Input, Select } from "../components/ui/FormUI";
import { useToast } from "../context/ToastContext";

interface Pickup {
  _id: string;
  application: string;
  applicant?: { displayName: string; email: string };
  pet?: { name: string };
  scheduledDate: string;
  method: string;
  location?: string;
  status: string;
  notes?: string;
}

type PickupAction = { kind: "schedule" } | { kind: "reschedule" | "complete" | "cancel" | "no-show"; pickup: Pickup };

/** datetime-local wants "YYYY-MM-DDTHH:mm" in local time. */
function toLocalInput(iso: string) {
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

const STAGES = ["submitted", "document_review", "interview", "home_visit", "risk_assessment", "approved", "adoption_scheduled", "completed"] as const;
const STAGE_LABELS: Record<string, string> = {
  submitted: "Submitted",
  document_review: "Document review",
  interview: "Interview",
  home_visit: "Home visit",
  risk_assessment: "Risk assessment",
  approved: "Approved",
  adoption_scheduled: "Scheduled",
  completed: "Completed",
};

/** A kanban-style pipeline view across the full application lifecycle. */
export default function AdoptionScheduling() {
  const applications = useApplications();
  const pickups = useResourceList<Pickup>("/api/adoption-pickups");
  const { showToast } = useToast();
  const [action, setAction] = useState<PickupAction | null>(null);
  const [applicationId, setApplicationId] = useState("");
  const [scheduledDate, setScheduledDate] = useState("");
  const [method, setMethod] = useState("Shelter pickup");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function openAction(next: PickupAction) {
    setFormError(null);
    setNotes("");
    if (next.kind === "schedule") {
      setApplicationId("");
      setScheduledDate("");
      setMethod("Shelter pickup");
      setLocation("");
    } else if (next.kind === "reschedule") {
      setScheduledDate(toLocalInput(next.pickup.scheduledDate));
      setMethod(next.pickup.method);
      setLocation(next.pickup.location ?? "");
    }
    setAction(next);
  }

  async function submitAction(e?: FormEvent) {
    e?.preventDefault();
    if (!action) return;
    setSaving(true);
    setFormError(null);
    try {
      if (action.kind === "schedule") {
        if (!applicationId || !scheduledDate) {
          setFormError("Choose an application and a date and time.");
          return;
        }
        await api.post("/api/adoption-pickups", { application: applicationId, scheduledDate, method, location: location || undefined, notes: notes || undefined });
        showToast("Pickup scheduled — the adopter was notified", "success");
      } else if (action.kind === "reschedule") {
        await api.put(`/api/adoption-pickups/${action.pickup._id}`, { scheduledDate, method, location: location || undefined });
        showToast("Pickup updated — the adopter was notified", "success");
      } else if (action.kind === "complete") {
        await api.put(`/api/adoption-pickups/${action.pickup._id}/complete`, { notes: notes || undefined });
        showToast("Pet handed over — adoption completed", "success");
      } else if (action.kind === "cancel") {
        await api.put(`/api/adoption-pickups/${action.pickup._id}/cancel`, { cancelReason: notes || undefined });
        showToast("Pickup cancelled", "success");
      } else {
        await api.put(`/api/adoption-pickups/${action.pickup._id}/no-show`);
        showToast("Marked as no-show", "success");
      }
      setAction(null);
      pickups.reload();
      applications.reload();
    } catch (err) {
      setFormError(getApiErrorMessage(err, "Could not save the pickup"));
    } finally {
      setSaving(false);
    }
  }

  const scheduledAppIds = new Set(pickups.rows.filter((p) => p.status === "scheduled").map((p) => p.application));
  const readyForPickup = applications.rows.filter(
    (a) =>
      a.status === "approved" &&
      (a.type === "foster" ? a.stage === "approved" : a.type === "adoption" && (a.stage === "approved" || a.stage === "adoption_scheduled")) &&
      !scheduledAppIds.has(a._id)
  );

  const pickupColumns: Column<Pickup>[] = [
    { key: "applicant", header: "Adopter / Fosterer", accessor: (p) => p.applicant?.displayName ?? "—" },
    { key: "pet", header: "Pet", accessor: (p) => p.pet?.name ?? "—" },
    { key: "scheduledDate", header: "Pickup date", accessor: (p) => new Date(p.scheduledDate).toLocaleString() },
    { key: "method", header: "Method", accessor: (p) => p.method },
    { key: "location", header: "Location", accessor: (p) => p.location || "—" },
    { key: "status", header: "Status", accessor: (p) => <StatusBadge status={p.status} /> },
  ];

  if (applications.loading) return <LoadingState />;
  if (applications.error) return <ErrorState message={applications.error} onRetry={applications.reload} />;

  const activeApps = applications.rows.filter((a) => a.status === "pending" || a.status === "approved");

  return (
    <div>
      <PageHeader
        title="Adoption Scheduling"
        description="Schedule pet pickups for approved adoptions, and track applications in progress."
        actions={
          <Button onClick={() => openAction({ kind: "schedule" })}>
            <Plus className="h-4 w-4" aria-hidden="true" /> Schedule pickup
          </Button>
        }
      />

      <h2 className="mb-2 text-sm font-semibold text-gray-900">Pet pickups</h2>
      <div className="mb-8">
        <DataTable
          columns={pickupColumns}
          rows={pickups.rows}
          rowKey={(p) => p._id}
          loading={pickups.loading}
          error={pickups.error}
          onRetry={pickups.reload}
          emptyTitle="No pickups scheduled"
          searchValue={pickups.search}
          onSearchChange={pickups.onSearchChange}
          filters={[{ key: "status", label: "Status", options: ["scheduled", "completed", "cancelled", "no-show"].map((v) => ({ value: v, label: v })) }]}
          filterValues={pickups.filters}
          onFilterChange={pickups.onFilterChange}
          page={pickups.pagination.page}
          pages={pickups.pagination.pages}
          total={pickups.pagination.total}
          onPageChange={pickups.setPage}
          rowActions={(p) =>
            p.status === "scheduled" ? (
              <div className="flex flex-wrap gap-1">
                <Button variant="secondary" onClick={() => openAction({ kind: "complete", pickup: p })}>Complete handover</Button>
                <Button variant="secondary" onClick={() => openAction({ kind: "reschedule", pickup: p })}>Reschedule</Button>
                <Button variant="secondary" onClick={() => openAction({ kind: "no-show", pickup: p })}>No-show</Button>
                <Button variant="secondary" onClick={() => openAction({ kind: "cancel", pickup: p })}>Cancel</Button>
              </div>
            ) : null
          }
        />
      </div>

      <h2 className="mb-2 text-sm font-semibold text-gray-900">Application pipeline</h2>

      {activeApps.length === 0 ? (
        <EmptyState title="No applications currently in progress" />
      ) : (
        <div className="grid grid-cols-1 gap-3 overflow-x-auto sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
          {STAGES.map((stage) => {
            const appsInStage = activeApps.filter((a) => a.stage === stage);
            return (
              <div key={stage} className="min-w-[180px]">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                  {STAGE_LABELS[stage]} ({appsInStage.length})
                </p>
                <div className="space-y-2">
                  {appsInStage.map((app) => (
                    <Card key={app._id} className="p-3">
                      <p className="text-sm font-medium text-gray-900">{app.applicant?.displayName}</p>
                      <p className="text-xs text-gray-500">{app.pet?.name}</p>
                      <div className="mt-1">
                        <StatusBadge status={app.type} tone="neutral" />
                      </div>
                    </Card>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal
        isOpen={!!action}
        onClose={() => setAction(null)}
        title={
          action?.kind === "schedule" ? "Schedule pet pickup"
          : action?.kind === "reschedule" ? "Reschedule pickup"
          : action?.kind === "complete" ? "Complete handover"
          : action?.kind === "cancel" ? "Cancel pickup"
          : "Mark as no-show"
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setAction(null)} disabled={saving}>Close</Button>
            <Button type="submit" form="pickup-form" loading={saving}>
              {action?.kind === "schedule" ? "Schedule" : action?.kind === "reschedule" ? "Save changes" : action?.kind === "complete" ? "Confirm handover" : "Confirm"}
            </Button>
          </>
        }
      >
        <form id="pickup-form" onSubmit={submitAction}>
          {formError && <div className="mb-4"><Alert tone="danger">{formError}</Alert></div>}

          {action?.kind === "schedule" && (
            <FormField label="Approved application" htmlFor="pickup-application">
              <Select id="pickup-application" required value={applicationId} onChange={(e) => setApplicationId(e.target.value)}>
                <option value="">Select an application</option>
                {readyForPickup.map((a) => <option key={a._id} value={a._id}>{a.applicant?.displayName} — {a.pet?.name}{a.type === "foster" ? " (foster)" : ""}</option>)}
              </Select>
            </FormField>
          )}

          {(action?.kind === "schedule" || action?.kind === "reschedule") && (
            <>
              <FormField label="Date & time" htmlFor="pickup-date">
                <Input id="pickup-date" type="datetime-local" required value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} />
              </FormField>
              <FormField label="Method" htmlFor="pickup-method">
                <Select id="pickup-method" value={method} onChange={(e) => setMethod(e.target.value)}>
                  <option>Shelter pickup</option>
                  <option>Home delivery</option>
                </Select>
              </FormField>
              <FormField label={method === "Home delivery" ? "Delivery address" : "Location (optional, defaults to the shelter)"} htmlFor="pickup-location">
                <Input id="pickup-location" required={method === "Home delivery"} value={location} onChange={(e) => setLocation(e.target.value)} />
              </FormField>
            </>
          )}

          {(action?.kind === "schedule" || action?.kind === "complete" || action?.kind === "cancel") && (
            <TextArea
              rows={3}
              placeholder={action.kind === "cancel" ? "Reason shown to the adopter (optional)" : "Notes (optional)"}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          )}

          {action?.kind === "complete" && <p className="mt-3 text-sm text-gray-600">This marks the adoption as completed.</p>}
          {action?.kind === "no-show" && <p className="text-sm text-gray-600">The adopter did not collect the pet. You can schedule a new pickup afterwards.</p>}
        </form>
      </Modal>
    </div>
  );
}
