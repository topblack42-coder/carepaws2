import { useEffect, useState } from "react";
import { api, getApiErrorMessage } from "../services/api";
import { PageHeader, Card } from "../components/ui/SharedUI";
import { LoadingState, ErrorState } from "../components/ui/StateDisplays";

interface AdoptionsReportRow {
  _id: string;
  count: number;
}
interface FinancialReportRow {
  _id: string;
  totalCentavos: number;
  count: number;
}
interface VolunteersReportRow {
  _id: string;
  count: number;
  totalHours: number;
}
interface WelfareReport {
  flaggedHealthChecks: number;
  conditionBreakdown: { _id: string; count: number }[];
}

export default function Reports() {
  const [adoptions, setAdoptions] = useState<AdoptionsReportRow[]>([]);
  const [financial, setFinancial] = useState<FinancialReportRow[]>([]);
  const [volunteers, setVolunteers] = useState<VolunteersReportRow[]>([]);
  const [welfare, setWelfare] = useState<WelfareReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.get("/api/reports/adoptions"),
      api.get("/api/reports/financial"),
      api.get("/api/reports/volunteers"),
      api.get("/api/reports/welfare"),
    ])
      .then(([a, f, v, w]) => {
        setAdoptions(a.data.data);
        setFinancial(f.data.data);
        setVolunteers(v.data.data);
        setWelfare(w.data.data);
      })
      .catch((err) => setError(getApiErrorMessage(err, "Failed to load reports")))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;

  return (
    <div>
      <PageHeader title="Reports" description="Operational reports across adoptions, finance, volunteers, and welfare." />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card>
          <h2 className="mb-2 text-sm font-semibold text-gray-700">Adoptions by status</h2>
          {adoptions.map((a) => (
            <div key={a._id} className="flex justify-between py-1 text-sm">
              <span className="capitalize text-gray-600">{a._id}</span>
              <span className="font-medium text-gray-900">{a.count}</span>
            </div>
          ))}
        </Card>

        <Card>
          <h2 className="mb-2 text-sm font-semibold text-gray-700">Financial by type</h2>
          {financial.map((f) => (
            <div key={f._id} className="flex justify-between py-1 text-sm">
              <span className="capitalize text-gray-600">{f._id.replace(/_/g, " ")}</span>
              <span className="font-medium text-gray-900">
                {(f.totalCentavos / 100).toLocaleString(undefined, { style: "currency", currency: "PHP" })}
              </span>
            </div>
          ))}
        </Card>

        <Card>
          <h2 className="mb-2 text-sm font-semibold text-gray-700">Volunteers by status</h2>
          {volunteers.map((v) => (
            <div key={v._id} className="flex justify-between py-1 text-sm">
              <span className="capitalize text-gray-600">{v._id}</span>
              <span className="font-medium text-gray-900">
                {v.count} ({v.totalHours}h)
              </span>
            </div>
          ))}
        </Card>

        <Card>
          <h2 className="mb-2 text-sm font-semibold text-gray-700">Welfare</h2>
          <p className="mb-2 text-sm text-status-danger">{welfare?.flaggedHealthChecks ?? 0} flagged health checks</p>
          {welfare?.conditionBreakdown.map((c) => (
            <div key={c._id} className="flex justify-between py-1 text-sm">
              <span className="text-gray-600">{c._id}</span>
              <span className="font-medium text-gray-900">{c.count}</span>
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}
