import { useState } from "react";
import { useResourceList } from "../hooks/useResourceList";
import { api, getApiErrorMessage } from "../services/api";
import { PageHeader } from "../components/ui/SharedUI";
import DataTable, { type Column } from "../components/ui/DataTable";
import StatusBadge from "../components/ui/StatusBadge";
import { Select } from "../components/ui/FormUI";
import { useToast } from "../context/ToastContext";

interface StaffRow {
  _id: string;
  displayName: string;
  email: string;
  role: string;
  status: string;
}

/**
 * Staff-role account management — the super_admin-only view for changing
 * a user's role, backed by the admin-configurable Role/permission model
 * (§5.1's Role document + "*" wildcard convention).
 */
export default function StaffManagement() {
  const list = useResourceList<StaffRow>("/api/auth/users");
  const { showToast } = useToast();
  const [updating, setUpdating] = useState<string | null>(null);

  async function changeRole(user: StaffRow, role: string) {
    setUpdating(user._id);
    try {
      await api.put(`/api/auth/users/${user._id}/role`, { role });
      showToast(`${user.displayName}'s role updated to ${role}`, "success");
      list.reload();
    } catch (err) {
      showToast(getApiErrorMessage(err, "Failed to update role"), "error");
    } finally {
      setUpdating(null);
    }
  }

  const columns: Column<StaffRow>[] = [
    { key: "displayName", header: "Name", accessor: (u) => u.displayName },
    { key: "email", header: "Email", accessor: (u) => u.email },
    { key: "status", header: "Status", accessor: (u) => <StatusBadge status={u.status} /> },
  ];

  return (
    <div>
      <PageHeader title="Staff & Roles" description="Assign shelter staff and admin roles. Super admin only." />
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
        page={list.pagination.page}
        pages={list.pagination.pages}
        total={list.pagination.total}
        onPageChange={list.setPage}
        rowActions={(u) => (
          <Select
            value={u.role}
            disabled={updating === u._id}
            onChange={(e) => changeRole(u, e.target.value)}
            className="w-auto text-xs"
            aria-label={`Change role for ${u.displayName}`}
          >
            <option value="user">User</option>
            <option value="staff">Staff</option>
            <option value="admin">Admin</option>
            <option value="super_admin">Super Admin</option>
          </Select>
        )}
      />
    </div>
  );
}
