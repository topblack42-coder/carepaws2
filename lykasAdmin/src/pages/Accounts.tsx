import { useState } from "react";
import { Ban, ShieldCheck, Trash2 } from "lucide-react";
import { useResourceList } from "../hooks/useResourceList";
import { api, getApiErrorMessage } from "../services/api";
import { PageHeader } from "../components/ui/SharedUI";
import DataTable, { type Column } from "../components/ui/DataTable";
import StatusBadge from "../components/ui/StatusBadge";
import ConfirmModal from "../components/ui/ConfirmModal";
import { useToast } from "../context/ToastContext";
import { useAuth } from "../context/AuthContext";
import IconButton from "../components/ui/IconButton";

interface AccountRow {
  _id: string;
  displayName: string;
  email: string;
  role: string;
  status: string;
  createdAt: string;
}

export default function Accounts() {
  const list = useResourceList<AccountRow>("/api/auth/users");
  const { showToast } = useToast();
  const { hasRole } = useAuth();
  const [suspending, setSuspending] = useState<AccountRow | null>(null);
  const [archiving, setArchiving] = useState<AccountRow | null>(null);
  const [saving, setSaving] = useState(false);
  // Id of the account a row action (reactivate/archive) is currently running
  // for; disables that row's buttons so a double-click can't send two requests.
  const [actingOn, setActingOn] = useState<string | null>(null);

  async function reactivate(u: AccountRow) {
    if (actingOn) return;
    setActingOn(u._id);
    try {
      await api.put(`/api/auth/users/${u._id}/status`, { status: "active" });
      showToast("Account reactivated", "success");
      list.reload();
    } catch (err) {
      showToast(getApiErrorMessage(err, "Failed to reactivate account"), "error");
    } finally {
      setActingOn(null);
    }
  }

  const columns: Column<AccountRow>[] = [
    { key: "displayName", header: "Name", accessor: (u) => u.displayName },
    { key: "email", header: "Email", accessor: (u) => u.email },
    { key: "role", header: "Role", accessor: (u) => <span className="capitalize">{u.role.replace(/_/g, " ")}</span> },
    { key: "status", header: "Status", accessor: (u) => <StatusBadge status={u.status} /> },
    { key: "createdAt", header: "Joined", accessor: (u) => new Date(u.createdAt).toLocaleDateString() },
  ];

  return (
    <div>
      <PageHeader title="User Accounts" description="All user accounts across the platform." />
      <DataTable
        columns={columns}
        rows={list.rows}
        rowKey={(u) => u._id}
        loading={list.loading}
        error={list.error}
        onRetry={list.reload}
        emptyTitle="No accounts found"
        searchValue={list.search}
        onSearchChange={list.onSearchChange}
        searchPlaceholder="Search by name or email…"
        filters={[
          { key: "role", label: "Role", options: [{ value: "user", label: "User" }, { value: "staff", label: "Staff" }, { value: "admin", label: "Admin" }, { value: "super_admin", label: "Super Admin" }] },
          { key: "status", label: "Status", options: [{ value: "active", label: "Active" }, { value: "suspended", label: "Suspended" }, { value: "locked", label: "Locked" }] },
        ]}
        filterValues={list.filters}
        onFilterChange={list.onFilterChange}
        page={list.pagination.page}
        pages={list.pagination.pages}
        total={list.pagination.total}
        onPageChange={list.setPage}
        rowActions={(u) => (
          <div className="flex justify-end gap-1">
            {u.status === "active" ? (
              <IconButton label={`Suspend ${u.displayName}`} tone="danger" disabled={actingOn === u._id} onClick={() => setSuspending(u)}>
                <Ban className="h-4 w-4" />
              </IconButton>
            ) : (
              <IconButton label={`Reactivate ${u.displayName}`} tone="success" disabled={actingOn === u._id} onClick={() => reactivate(u)}>
                <ShieldCheck className="h-4 w-4" />
              </IconButton>
            )}
            {hasRole("super_admin") && (
              <IconButton label={`Archive ${u.displayName}`} disabled={actingOn === u._id} onClick={() => setArchiving(u)}>
                <Trash2 className="h-4 w-4" />
              </IconButton>
            )}
          </div>
        )}
      />

      <ConfirmModal
        isOpen={!!suspending}
        title="Suspend this account?"
        message={`${suspending?.displayName} will lose access immediately and all active sessions will be revoked.`}
        confirmLabel="Suspend"
        variant="danger"
        loading={saving}
        onConfirm={async () => {
          if (!suspending) return;
          setSaving(true);
          try {
            await api.put(`/api/auth/users/${suspending._id}/status`, { status: "suspended" });
            showToast("Account suspended", "success");
            list.reload();
          } catch (err) {
            showToast(getApiErrorMessage(err, "Failed to suspend account"), "error");
          } finally {
            setSaving(false);
            setSuspending(null);
          }
        }}
        onCancel={() => setSuspending(null)}
      />

      <ConfirmModal
        isOpen={!!archiving}
        title="Archive this account?"
        message={`${archiving?.displayName} will be archived and removed from the active accounts list.`}
        confirmLabel="Archive"
        variant="danger"
        loading={saving}
        onConfirm={async () => {
          if (!archiving || saving) return;
          setSaving(true);
          try {
            await api.delete(`/api/auth/users/${archiving._id}`);
            showToast("Account archived", "success");
            list.reload();
          } catch (err) {
            showToast(getApiErrorMessage(err, "Failed to archive account"), "error");
          } finally {
            setSaving(false);
            setArchiving(null);
          }
        }}
        onCancel={() => setArchiving(null)}
      />
    </div>
  );
}
