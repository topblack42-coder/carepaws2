import { useState } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { useResourceList } from "../hooks/useResourceList";
import { api, getApiErrorMessage } from "../services/api";
import { PageHeader } from "../components/ui/SharedUI";
import DataTable, { type Column } from "../components/ui/DataTable";
import StatusBadge from "../components/ui/StatusBadge";
import Button from "../components/ui/Button";
import ConfirmModal from "../components/ui/ConfirmModal";
import AddShiftModal from "../components/shifts/AddShiftModal";
import EditShiftModal from "../components/shifts/EditShiftModal";
import { useToast } from "../context/ToastContext";
import IconButton from "../components/ui/IconButton";

interface Shift {
  _id: string;
  title: string;
  date: string;
  durationHours: number;
  capacity: number;
  status: string;
  user?: { displayName: string };
}

export default function Shifts() {
  const list = useResourceList<Shift>("/api/appointments");
  const { showToast } = useToast();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Shift | null>(null);
  const [deleting, setDeleting] = useState<Shift | null>(null);
  const [saving, setSaving] = useState(false);

  const columns: Column<Shift>[] = [
    { key: "title", header: "Shift", accessor: (s) => s.title },
    { key: "date", header: "Date", accessor: (s) => new Date(s.date).toLocaleString() },
    { key: "duration", header: "Duration", accessor: (s) => `${s.durationHours}h` },
    { key: "volunteer", header: "Volunteer", accessor: (s) => s.user?.displayName || "Unfilled" },
    { key: "status", header: "Status", accessor: (s) => <StatusBadge status={s.status} /> },
  ];

  return (
    <div>
      <PageHeader
        title="Shifts & Volunteers"
        description="Schedule and staff shelter shifts."
        actions={
          <Button onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" aria-hidden="true" /> Add shift
          </Button>
        }
      />
      <DataTable
        columns={columns}
        rows={list.rows}
        rowKey={(s) => s._id}
        loading={list.loading}
        error={list.error}
        onRetry={list.reload}
        emptyTitle="No shifts scheduled"
        searchValue={list.search}
        onSearchChange={list.onSearchChange}
        page={list.pagination.page}
        pages={list.pagination.pages}
        total={list.pagination.total}
        onPageChange={list.setPage}
        rowActions={(s) => (
          <div className="flex justify-end gap-1">
            <IconButton label="Edit shift" onClick={() => setEditing(s)}>
              <Pencil className="h-4 w-4" />
            </IconButton>
            <IconButton label="Delete shift" onClick={() => setDeleting(s)}>
              <Trash2 className="h-4 w-4" />
            </IconButton>
          </div>
        )}
      />

      <AddShiftModal
        isOpen={adding}
        onClose={() => setAdding(false)}
        submitting={saving}
        onSubmit={async (values) => {
          setSaving(true);
          try {
            await api.post("/api/appointments", values);
            showToast("Shift added", "success");
            setAdding(false);
            list.reload();
          } catch (err) {
            showToast(getApiErrorMessage(err, "Failed to add shift"), "error");
          } finally {
            setSaving(false);
          }
        }}
      />

      <EditShiftModal
        shift={editing}
        onClose={() => setEditing(null)}
        submitting={saving}
        onSubmit={async (id, values) => {
          setSaving(true);
          try {
            await api.put(`/api/appointments/${id}`, values);
            showToast("Shift updated", "success");
            setEditing(null);
            list.reload();
          } catch (err) {
            showToast(getApiErrorMessage(err, "Failed to update shift"), "error");
          } finally {
            setSaving(false);
          }
        }}
      />

      <ConfirmModal
        isOpen={!!deleting}
        title="Delete this shift?"
        message={`"${deleting?.title}" will be permanently removed.`}
        confirmLabel="Delete"
        variant="danger"
        loading={saving}
        onConfirm={async () => {
          if (!deleting) return;
          setSaving(true);
          try {
            await api.delete(`/api/appointments/${deleting._id}`);
            showToast("Shift deleted", "success");
            list.reload();
          } catch (err) {
            showToast(getApiErrorMessage(err, "Failed to delete shift"), "error");
          } finally {
            setSaving(false);
            setDeleting(null);
          }
        }}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
