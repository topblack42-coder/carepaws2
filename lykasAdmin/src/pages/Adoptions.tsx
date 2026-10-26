import { useState } from "react";
import { CheckCircle2, XCircle, Eye } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useApplications, type Application } from "../hooks/useApplications";
import { PageHeader } from "../components/ui/SharedUI";
import DataTable, { type Column } from "../components/ui/DataTable";
import StatusBadge from "../components/ui/StatusBadge";
import ConfirmModal from "../components/ui/ConfirmModal";
import Button from "../components/ui/Button";
import { useToast } from "../context/ToastContext";
import IconButton from "../components/ui/IconButton";

const STAGE_LABELS: Record<string, string> = {
  submitted: "Submitted",
  document_review: "Document review",
  interview: "Interview",
  home_visit: "Home visit",
  risk_assessment: "Risk assessment",
  approved: "Approved",
  adoption_scheduled: "Adoption scheduled",
  completed: "Completed",
  rejected: "Rejected",
};

export default function Adoptions() {
  const applications = useApplications();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState<{ app: Application; action: "approved" | "rejected" } | null>(null);

  const columns: Column<Application>[] = [
    {
      key: "applicant",
      header: "Applicant",
      accessor: (a) => (
        <div>
          <p className="font-medium text-gray-900">{a.applicant?.displayName}</p>
          <p className="text-xs text-gray-500">{a.applicant?.email}</p>
        </div>
      ),
    },
    { key: "pet", header: "Pet", accessor: (a) => a.pet?.name ?? "—" },
    { key: "type", header: "Type", accessor: (a) => <span className="capitalize">{a.type}</span> },
    { key: "stage", header: "Stage", accessor: (a) => STAGE_LABELS[a.stage] ?? a.stage },
    { key: "status", header: "Status", accessor: (a) => <StatusBadge status={a.status} /> },
    { key: "createdAt", header: "Submitted", accessor: (a) => new Date(a.createdAt).toLocaleDateString() },
  ];

  return (
    <div>
      <PageHeader title="Adoption Applications" description="Review and progress adoption and foster applications." />

      <DataTable
        columns={columns}
        rows={applications.rows}
        rowKey={(a) => a._id}
        loading={applications.loading}
        error={applications.error}
        onRetry={applications.reload}
        emptyTitle="No applications yet"
        searchValue={applications.search}
        onSearchChange={applications.onSearchChange}
        searchPlaceholder="Search applicant name…"
        filters={[
          { key: "status", label: "Status", options: [{ value: "pending", label: "Pending" }, { value: "approved", label: "Approved" }, { value: "rejected", label: "Rejected" }] },
          { key: "type", label: "Type", options: [{ value: "adoption", label: "Adoption" }, { value: "foster", label: "Foster" }] },
        ]}
        filterValues={applications.filters}
        onFilterChange={applications.onFilterChange}
        page={applications.pagination.page}
        pages={applications.pagination.pages}
        total={applications.pagination.total}
        onPageChange={applications.setPage}
        rowActions={(app) => (
          <div className="flex justify-end gap-1">
            <IconButton label={`View application from ${app.applicant?.displayName}`} onClick={() => navigate(`/adoptions/${app._id}`, { state: { fromList: true } })}>
              <Eye className="h-4 w-4" />
            </IconButton>
            {app.status === "pending" && app.stage === "risk_assessment" && (
              <>
                <IconButton label="Approve" tone="success" onClick={() => setConfirming({ app, action: "approved" })}>
                  <CheckCircle2 className="h-4 w-4" />
                </IconButton>
                <IconButton label="Reject" tone="danger" onClick={() => setConfirming({ app, action: "rejected" })}>
                  <XCircle className="h-4 w-4" />
                </IconButton>
              </>
            )}
          </div>
        )}
      />

      <ConfirmModal
        isOpen={!!confirming}
        title={confirming?.action === "approved" ? "Approve this application?" : "Reject this application?"}
        message={
          confirming?.action === "approved"
            ? `${confirming?.app.applicant?.displayName} will be approved to adopt ${confirming?.app.pet?.name}. This marks the pet as Adopted.`
            : `${confirming?.app.applicant?.displayName}'s application will be rejected and the pet returned to Available.`
        }
        confirmLabel={confirming?.action === "approved" ? "Approve" : "Reject"}
        variant={confirming?.action === "approved" ? "primary" : "danger"}
        loading={applications.mutating}
        onConfirm={async () => {
          if (!confirming) return;
          const ok = await applications.updateStatus(confirming.app._id, confirming.action);
          if (ok) showToast(`Application ${confirming.action}`, "success");
          setConfirming(null);
        }}
        onCancel={() => setConfirming(null)}
      />

      <div className="mt-4 flex justify-end">
        <Button variant="secondary" onClick={() => navigate("/adoptions/new")}>
          New application (on behalf of an applicant)
        </Button>
      </div>
    </div>
  );
}
