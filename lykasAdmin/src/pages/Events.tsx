import { useState, type FormEvent } from "react";
import { Pencil, Plus, XCircle } from "lucide-react";
import { useResourceList } from "../hooks/useResourceList";
import { api, getApiErrorMessage } from "../services/api";
import { PageHeader } from "../components/ui/SharedUI";
import DataTable, { type Column } from "../components/ui/DataTable";
import StatusBadge from "../components/ui/StatusBadge";
import Button from "../components/ui/Button";
import Modal from "../components/ui/Modal";
import ConfirmModal from "../components/ui/ConfirmModal";
import Alert from "../components/ui/Alert";
import { FormField, Input, Select } from "../components/ui/FormUI";
import TextArea from "../components/ui/TextArea";
import { useToast } from "../context/ToastContext";
import IconButton from "../components/ui/IconButton";

interface EventRow {
  _id: string;
  title: string;
  category: string;
  date: string;
  endDate?: string;
  location: string;
  status: string;
  currentAttendees: number;
  maxAttendees?: number;
  description?: string;
}

const EMPTY_FORM = {
  title: "",
  category: "Community",
  date: "",
  endDate: "",
  location: "",
  description: "",
  maxAttendees: "",
  status: "upcoming",
};

export default function Events() {
  const list = useResourceList<EventRow>("/api/events");
  const { showToast } = useToast();
  const [editing, setEditing] = useState<EventRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<EventRow | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);

  function openCreate() {
    setForm(EMPTY_FORM);
    setError(null);
    setCreating(true);
    setEditing(null);
  }

  function openEdit(event: EventRow) {
    const toLocal = (value?: string) => (value ? new Date(value).toISOString().slice(0, 16) : "");
    setForm({
      title: event.title,
      category: event.category,
      date: toLocal(event.date),
      endDate: toLocal(event.endDate),
      location: event.location || "",
      description: event.description || "",
      maxAttendees: event.maxAttendees ? String(event.maxAttendees) : "",
      status: event.status,
    });
    setError(null);
    setEditing(event);
    setCreating(false);
  }

  function closeModal() {
    if (!saving) {
      setCreating(false);
      setEditing(null);
    }
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload = {
        title: form.title,
        category: form.category,
        date: form.date,
        ...(form.endDate ? { endDate: form.endDate } : {}),
        location: form.location,
        description: form.description,
        ...(form.maxAttendees ? { maxAttendees: Number(form.maxAttendees) } : {}),
        ...(editing ? { status: form.status } : {}),
      };

      if (editing) {
        await api.put(`/api/events/${editing._id}`, payload);
        showToast("Event updated", "success");
      } else {
        await api.post("/api/events", payload);
        showToast("Event created", "success");
      }

      closeModal();
      list.reload();
    } catch (err) {
      setError(getApiErrorMessage(err, editing ? "Failed to update event" : "Failed to create event"));
    } finally {
      setSaving(false);
    }
  }

  async function confirmCancelEvent() {
    if (!cancelling) return;
    setCancelBusy(true);
    try {
      await api.delete(`/api/events/${cancelling._id}`);
      showToast("Event cancelled", "success");
      setCancelling(null);
      list.reload();
    } catch (err) {
      showToast(getApiErrorMessage(err, "Failed to cancel event"), "error");
    } finally {
      setCancelBusy(false);
    }
  }

  const columns: Column<EventRow>[] = [
    { key: "title", header: "Event", accessor: (e) => <span className="font-medium text-gray-900">{e.title}</span> },
    { key: "category", header: "Category", accessor: (e) => e.category },
    { key: "date", header: "Date", accessor: (e) => new Date(e.date).toLocaleString() },
    { key: "location", header: "Location", accessor: (e) => e.location || "—" },
    { key: "attendees", header: "Attendees", accessor: (e) => `${e.currentAttendees}${e.maxAttendees ? `/${e.maxAttendees}` : ""}` },
    { key: "status", header: "Status", accessor: (e) => <StatusBadge status={e.status} /> },
  ];

  return (
    <div>
      <PageHeader
        title="Events"
        description="Adoption drives, fundraisers, and community events."
        actions={
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" aria-hidden="true" /> New event
          </Button>
        }
      />
      <DataTable
        columns={columns}
        rows={list.rows}
        rowKey={(e) => e._id}
        loading={list.loading}
        error={list.error}
        onRetry={list.reload}
        emptyTitle="No events yet"
        searchValue={list.search}
        onSearchChange={list.onSearchChange}
        filters={[{ key: "status", label: "Status", options: ["upcoming", "ongoing", "completed", "cancelled"].map((s) => ({ value: s, label: s })) }]}
        filterValues={list.filters}
        onFilterChange={list.onFilterChange}
        page={list.pagination.page}
        pages={list.pagination.pages}
        total={list.pagination.total}
        onPageChange={list.setPage}
        rowActions={(event) => (
          <div className="flex justify-end gap-1">
            <IconButton label="Edit event" onClick={() => openEdit(event)}>
              <Pencil className="h-4 w-4" />
            </IconButton>
            {event.status !== "cancelled" && event.status !== "completed" && (
              <IconButton label="Cancel event" tone="danger" onClick={() => setCancelling(event)}>
                <XCircle className="h-4 w-4" />
              </IconButton>
            )}
          </div>
        )}
      />

      <Modal
        isOpen={creating || !!editing}
        onClose={closeModal}
        title={editing ? "Edit event" : "New event"}
        footer={
          <>
            <Button variant="secondary" onClick={closeModal} disabled={saving}>Cancel</Button>
            <Button type="submit" form="event-form" loading={saving}>{editing ? "Save changes" : "Create"}</Button>
          </>
        }
      >
        <form id="event-form" onSubmit={handleSave}>
          {error && <div className="mb-4"><Alert tone="danger">{error}</Alert></div>}
          <FormField label="Title" htmlFor="ev-title">
            <Input id="ev-title" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </FormField>
          <FormField label="Category" htmlFor="ev-category">
            <Select id="ev-category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              <option value="Adoption Drive">Adoption Drive</option>
              <option value="Fundraiser">Fundraiser</option>
              <option value="Training">Training</option>
              <option value="Community">Community</option>
              <option value="Volunteer">Volunteer</option>
              <option value="Other">Other</option>
            </Select>
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Start" htmlFor="ev-date">
              <Input id="ev-date" type="datetime-local" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </FormField>
            <FormField label="End (optional)" htmlFor="ev-end-date">
              <Input id="ev-end-date" type="datetime-local" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
            </FormField>
          </div>
          <FormField label="Capacity (optional)" htmlFor="ev-capacity">
            <Input id="ev-capacity" type="number" min={1} value={form.maxAttendees} onChange={(e) => setForm({ ...form, maxAttendees: e.target.value })} />
          </FormField>
          {editing && (
            <FormField label="Status" htmlFor="ev-status">
              <Select id="ev-status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                <option value="upcoming">Upcoming</option>
                <option value="ongoing">Ongoing</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </Select>
            </FormField>
          )}
          <FormField label="Location" htmlFor="ev-location">
            <Input id="ev-location" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
          </FormField>
          <FormField label="Description" htmlFor="ev-description">
            <TextArea id="ev-description" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </FormField>
        </form>
      </Modal>
      <ConfirmModal
        isOpen={cancelling !== null}
        title="Cancel event"
        message={`Cancel "${cancelling?.title ?? ""}"? Registrations and attendance history will be preserved.`}
        confirmLabel="Cancel event"
        variant="danger"
        loading={cancelBusy}
        onConfirm={confirmCancelEvent}
        onCancel={() => setCancelling(null)}
      />
    </div>
  );
}
