import { useState } from "react";
import { CheckCircle2, Flag } from "lucide-react";
import { useResourceList } from "../hooks/useResourceList";
import { api, getApiErrorMessage } from "../services/api";
import { PageHeader } from "../components/ui/SharedUI";
import DataTable, { type Column } from "../components/ui/DataTable";
import StatusBadge from "../components/ui/StatusBadge";
import { useToast } from "../context/ToastContext";
import IconButton from "../components/ui/IconButton";

interface MonitoringReport {
  _id: string;
  pet: { name: string };
  submittedBy: { displayName: string };
  monitoringPeriod: number;
  scheduledDate: string;
  dueDate: string;
  reportDate?: string | null;
  submittedAt?: string | null;
  overallCondition?: string;
  status: "scheduled" | "pending" | "reviewed" | "flagged";
}

export default function Monitoring() {
  const list = useResourceList<MonitoringReport>("/api/monitoring-reports");
  const { showToast } = useToast();
  const [actingOn, setActingOn] = useState<string | null>(null);

  async function review(report: MonitoringReport, status: "reviewed" | "flagged") {
    setActingOn(report._id);
    try {
      const response = await api.put(`/api/monitoring-reports/${report._id}/review`, { status });
      if (!response.data?.success) throw new Error("Monitoring report review failed");
      showToast(status === "reviewed" ? "Monitoring completed" : "Report flagged for follow-up", "success");
      list.reload();
    } catch (err) {
      showToast(getApiErrorMessage(err, "Failed to update report"), "error");
    } finally {
      setActingOn(null);
    }
  }

  const columns: Column<MonitoringReport>[] = [
    { key: "pet", header: "Pet", accessor: (r) => r.pet?.name },
    { key: "submittedBy", header: "Adopter", accessor: (r) => r.submittedBy?.displayName },
    { key: "period", header: "Period", accessor: (r) => `Check-in ${r.monitoringPeriod}` },
    {
      key: "schedule",
      header: "Schedule",
      accessor: (r) => r.status === "scheduled"
        ? new Date(r.scheduledDate).toLocaleDateString()
        : new Date(r.dueDate).toLocaleDateString(),
    },
    { key: "reportDate", header: "Submitted", accessor: (r) => r.reportDate ? new Date(r.reportDate).toLocaleDateString() : "—" },
    { key: "overallCondition", header: "Condition", accessor: (r) => r.overallCondition || "—" },
    { key: "status", header: "Status", accessor: (r) => <StatusBadge status={r.status} /> },
  ];

  return (
    <div>
      <PageHeader title="Post-Adoption Monitoring" description="Track scheduled check-ins and review submitted monitoring reports." />
      <DataTable
        columns={columns}
        rows={list.rows}
        rowKey={(r) => r._id}
        loading={list.loading}
        error={list.error}
        onRetry={list.reload}
        emptyTitle="No post-adoption monitoring records yet"
        searchValue={list.search}
        onSearchChange={list.onSearchChange}
        filters={[{
          key: "status",
          label: "Status",
          options: [
            { value: "scheduled", label: "Scheduled" },
            { value: "pending", label: "Pending review" },
            { value: "reviewed", label: "Completed" },
            { value: "flagged", label: "Flagged" },
          ],
        }]}
        filterValues={list.filters}
        onFilterChange={list.onFilterChange}
        page={list.pagination.page}
        pages={list.pagination.pages}
        total={list.pagination.total}
        onPageChange={list.setPage}
        rowActions={(r) =>
          r.status === "pending" && r.submittedAt ? (
            <div className="flex justify-end gap-1">
              <IconButton label="Complete monitoring report" tone="success" disabled={actingOn === r._id} onClick={() => review(r, "reviewed")}>
                <CheckCircle2 className="h-4 w-4" />
              </IconButton>
              <IconButton label="Flag for follow-up" tone="danger" disabled={actingOn === r._id} onClick={() => review(r, "flagged")}>
                <Flag className="h-4 w-4" />
              </IconButton>
            </div>
          ) : null
        }
      />
    </div>
  );
}
