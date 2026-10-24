import { useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { useResourceList } from "../hooks/useResourceList";
import { api, getApiErrorMessage } from "../services/api";
import { PageHeader } from "../components/ui/SharedUI";
import DataTable, { type Column } from "../components/ui/DataTable";
import StatusBadge from "../components/ui/StatusBadge";
import { useToast } from "../context/ToastContext";

interface VerificationRow {
  _id: string;
  displayName: string;
  email: string;
  identityVerificationStatus: string;
  idDocumentUrl?: string | null;
  phone?: string | null;
  address?: string | null;
  phoneVerified: boolean;
  addressConfirmed: boolean;
}

export default function UserVerification() {
  const list = useResourceList<VerificationRow>("/api/auth/users/verification-queue");
  const { showToast } = useToast();
  const [actingOn, setActingOn] = useState<string | null>(null);

  async function decide(user: VerificationRow, status: "verified" | "rejected") {
    setActingOn(user._id);
    try {
      await api.put(`/api/auth/users/${user._id}/verification`, { identityVerificationStatus: status });
      showToast(`Identity ${status}`, "success");
      list.reload();
    } catch (err) {
      showToast(getApiErrorMessage(err, "Failed to update verification"), "error");
    } finally {
      setActingOn(null);
    }
  }

  const columns: Column<VerificationRow>[] = [
    { key: "displayName", header: "Name", accessor: (u) => u.displayName },
    { key: "email", header: "Email", accessor: (u) => u.email },
    { key: "phone", header: "Phone", accessor: (u) => u.phone || "—" },
    { key: "address", header: "Address", accessor: (u) => u.address || "—" },
    {
      key: "idDocumentUrl",
      header: "ID file",
      accessor: (u) =>
        u.idDocumentUrl ? (
          <a href={u.idDocumentUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">
            View ID
          </a>
        ) : (
          "—"
        ),
    },
    { key: "identityVerificationStatus", header: "ID status", accessor: (u) => <StatusBadge status={u.identityVerificationStatus} /> },
  ];

  return (
    <div>
      <PageHeader title="User Verification" description="Identity verification queue — pending applicants." />
      <DataTable
        columns={columns}
        rows={list.rows}
        rowKey={(u) => u._id}
        loading={list.loading}
        error={list.error}
        onRetry={list.reload}
        emptyTitle="No pending verifications"
        searchValue={list.search}
        onSearchChange={list.onSearchChange}
        page={list.pagination.page}
        pages={list.pagination.pages}
        total={list.pagination.total}
        onPageChange={list.setPage}
        rowActions={(u) => (
          <div className="flex justify-end gap-1">
            <button
              type="button"
              disabled={actingOn === u._id}
              onClick={() => decide(u, "verified")}
              className="rounded-lg p-1.5 text-status-success hover:bg-status-successBg disabled:opacity-50"
              aria-label="Verify identity"
            >
              <CheckCircle2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              disabled={actingOn === u._id}
              onClick={() => decide(u, "rejected")}
              className="rounded-lg p-1.5 text-status-danger hover:bg-status-dangerBg disabled:opacity-50"
              aria-label="Reject identity"
            >
              <XCircle className="h-4 w-4" />
            </button>
          </div>
        )}
      />
    </div>
  );
}
