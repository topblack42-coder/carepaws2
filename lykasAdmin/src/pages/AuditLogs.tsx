import { useResourceList } from "../hooks/useResourceList";
import { PageHeader } from "../components/ui/SharedUI";
import DataTable, { type Column } from "../components/ui/DataTable";

interface Person {
  displayName: string;
  email?: string;
}

interface AuditLogEntry {
  _id: string;
  actor?: Person;
  action: string;
  actionLabel?: string;
  description?: string;
  /** The person this change was about (e.g. the adopter whose application was approved). */
  user?: Person | null;
  /** The item that was changed (e.g. "Adoption application for Bella"). */
  subject?: string | null;
  createdAt: string;
}

function PersonCell({ person }: { person?: Person | null }) {
  if (!person) return <span className="text-gray-400">—</span>;
  return (
    <div>
      <div className="font-medium text-gray-900">{person.displayName}</div>
      {person.email && <div className="text-xs text-gray-500">{person.email}</div>}
    </div>
  );
}

function formatWhen(iso: string) {
  const date = new Date(iso);
  return {
    day: date.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" }),
    time: date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }),
  };
}

export default function AuditLogs() {
  const list = useResourceList<AuditLogEntry>("/api/audit-logs");

  const columns: Column<AuditLogEntry>[] = [
    {
      key: "createdAt",
      header: "When",
      accessor: (a) => {
        const when = formatWhen(a.createdAt);
        return (
          <div>
            <div className="text-gray-900">{when.day}</div>
            <div className="text-xs text-gray-500">{when.time}</div>
          </div>
        );
      },
    },
    { key: "actor", header: "Done by (staff)", accessor: (a) => <PersonCell person={a.actor} /> },
    {
      key: "action",
      header: "What happened",
      accessor: (a) => (
        <div className="max-w-md">
          <div className="text-gray-900">{a.description || a.actionLabel || a.action}</div>
          {a.subject && <div className="text-xs text-gray-500">{a.subject}</div>}
        </div>
      ),
    },
    { key: "user", header: "User affected", accessor: (a) => <PersonCell person={a.user} /> },
  ];

  return (
    <div>
      <PageHeader
        title="Audit Trails"
        description="A record of who changed what, and when. Every time a staff member approves an application, edits a pet or changes an account, it shows up here. Only super admins can see this page."
      />
      <DataTable
        columns={columns}
        rows={list.rows}
        rowKey={(a) => a._id}
        loading={list.loading}
        error={list.error}
        onRetry={list.reload}
        emptyTitle="Nothing has been recorded yet"
        emptyDescription="When staff make changes, they will appear here."
        searchValue={list.search}
        onSearchChange={list.onSearchChange}
        searchPlaceholder="Search by person, pet or what happened…"
        page={list.pagination.page}
        pages={list.pagination.pages}
        total={list.pagination.total}
        onPageChange={list.setPage}
      />
    </div>
  );
}
