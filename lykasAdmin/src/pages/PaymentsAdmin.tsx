import { useEffect, useState } from "react";
import { useResourceList } from "../hooks/useResourceList";
import { api } from "../services/api";
import { PageHeader } from "../components/ui/SharedUI";
import DataTable, { type Column } from "../components/ui/DataTable";
import StatusBadge from "../components/ui/StatusBadge";
import DonationTracker from "../components/Community/DonationTracker";

interface Payment {
  _id: string;
  paidBy: { displayName: string; email: string };
  type: string;
  amount: number;
  status: string;
  paymentMethod?: string;
  createdAt: string;
}

export default function PaymentsAdmin() {
  const list = useResourceList<Payment>("/api/payments");
  const [summary, setSummary] = useState<{ _id: string; total: number; count: number }[]>([]);

  useEffect(() => {
    api.get("/api/payments/summary").then((res) => setSummary(res.data.data));
  }, []);

  const columns: Column<Payment>[] = [
    { key: "paidBy", header: "Payer", accessor: (p) => p.paidBy?.displayName },
    { key: "type", header: "Type", accessor: (p) => <span className="capitalize">{p.type.replace(/_/g, " ")}</span> },
    { key: "amount", header: "Amount", accessor: (p) => (p.amount / 100).toLocaleString(undefined, { style: "currency", currency: "PHP" }) },
    { key: "method", header: "Method", accessor: (p) => p.paymentMethod || "—" },
    { key: "status", header: "Status", accessor: (p) => <StatusBadge status={p.status} /> },
    { key: "createdAt", header: "Date", accessor: (p) => new Date(p.createdAt).toLocaleDateString() },
  ];

  return (
    <div>
      <PageHeader title="Payments" description="All payments processed through the platform." />

      <DonationTracker stats={summary.map((s) => ({ _id: s._id, totalCentavos: s.total, count: s.count }))} />

      <DataTable
        columns={columns}
        rows={list.rows}
        rowKey={(p) => p._id}
        loading={list.loading}
        error={list.error}
        onRetry={list.reload}
        emptyTitle="No payments yet"
        searchValue={list.search}
        onSearchChange={list.onSearchChange}
        filters={[
          { key: "type", label: "Type", options: [{ value: "donation", label: "Donation" }, { value: "adoption_fee", label: "Adoption fee" }, { value: "event_fee", label: "Event fee" }] },
          { key: "status", label: "Status", options: [{ value: "pending", label: "Pending" }, { value: "paid", label: "Paid" }, { value: "failed", label: "Failed" }, { value: "cancelled", label: "Cancelled" }, { value: "refunded", label: "Refunded" }] },
        ]}
        filterValues={list.filters}
        onFilterChange={list.onFilterChange}
        page={list.pagination.page}
        pages={list.pagination.pages}
        total={list.pagination.total}
        onPageChange={list.setPage}
      />
    </div>
  );
}
