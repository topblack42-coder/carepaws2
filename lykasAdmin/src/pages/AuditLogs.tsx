import { useResourceList } from "../hooks/useResourceList";
import { PageHeader } from "../components/ui/SharedUI";
import DataTable, { type Column } from "../components/ui/DataTable";

interface AuditLogEntry {
  _id: string;
  actor: { displayName: string };
  action: string;
  actionLabel?: string;
  description?: string;
  entityType?: string;
  entityLabel?: string;
  createdAt: string;
}

export default function AuditLogs() {
  const list = useResourceList<AuditLogEntry>("/api/audit-logs");

  const columns: Column<AuditLogEntry>[] = [
    { key: "actor", header: "Actor", accessor: (a) => a.actor?.displayName },
    { key: "action", header: "Action", accessor: (a) => (
        <div>
          <div className="font-medium">{a.actionLabel || a.action}</div>
          {a.description && <div className="text-xs text-gray-500">{a.description}</div>}
        </div>
      ),
    },
    { key: "entityType", header: "Entity", accessor: (a) => a.entityLabel || a.entityType || "—" },
    { key: "createdAt", header: "When", accessor: (a) => new Date(a.createdAt).toLocaleString() },
  ];

  return (
    <div>
      <PageHeader title="System Audit Logs" description="Every staff-performed mutation on a protected resource. Super admin only." />
      <DataTable
        columns={columns}
        rows={list.rows}
        rowKey={(a) => a._id}
        loading={list.loading}
        error={list.error}
        onRetry={list.reload}
        emptyTitle="No audit log entries yet"
        searchValue={list.search}
        onSearchChange={list.onSearchChange}
        searchPlaceholder="Search actions…"
        page={list.pagination.page}
        pages={list.pagination.pages}
        total={list.pagination.total}
        onPageChange={list.setPage}
      />
    </div>
  );
}