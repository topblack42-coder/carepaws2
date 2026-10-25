import { useCallback, useEffect, useState } from "react";
import { api, getApiErrorMessage } from "../services/api";
import { PageHeader, StatCard, Card } from "../components/ui/SharedUI";
import { LoadingState, ErrorState } from "../components/ui/StateDisplays";
import { useRealtime } from "../context/RealtimeContext";

interface Overview {
  totalPets: number;
  totalApplications: number;
  adoptionRate: number;
}

interface TrendPoint {
  _id: { year: number; month: number };
  count: number;
}

interface Breakdown {
  _id: { species: string; status: string };
  count: number;
}

export default function Analytics() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [trends, setTrends] = useState<TrendPoint[]>([]);
  const [breakdown, setBreakdown] = useState<Breakdown[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.get("/api/analytics/overview"), api.get("/api/analytics/trends"), api.get("/api/analytics/pets-breakdown")])
      .then(([overviewRes, trendsRes, breakdownRes]) => {
        setOverview(overviewRes.data.data);
        setTrends(trendsRes.data.data);
        setBreakdown(breakdownRes.data.data);
      })
      .catch((err) => setError(getApiErrorMessage(err, "Failed to load analytics")))
      .finally(() => setLoading(false));
  }, []);

  const refreshSilently = useCallback(() => {
    Promise.all([api.get("/api/analytics/overview"), api.get("/api/analytics/trends"), api.get("/api/analytics/pets-breakdown")])
      .then(([overviewRes, trendsRes, breakdownRes]) => {
        setOverview(overviewRes.data.data);
        setTrends(trendsRes.data.data);
        setBreakdown(breakdownRes.data.data);
      })
      .catch(() => {});
  }, []);
  useRealtime(["Pet", "Application", "Payment", "Volunteer", "Foster"], refreshSilently);

  if (loading) return <LoadingState />;
  if (error || !overview) return <ErrorState message={error ?? "No data"} />;

  const maxTrend = Math.max(1, ...trends.map((t) => t.count));

  return (
    <div>
      <PageHeader title="Analytics" description="Trends and breakdowns across the platform." />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Total pets" value={overview.totalPets} />
        <StatCard label="Total applications" value={overview.totalApplications} />
        <StatCard label="Adoption rate" value={`${(overview.adoptionRate * 100).toFixed(0)}%`} />
      </div>

      <Card className="mb-4">
        <h2 className="mb-3 text-sm font-semibold text-gray-700">Application trend (last 6 months)</h2>
        <div className="flex h-32 items-end gap-2">
          {trends.map((t) => (
            <div key={`${t._id.year}-${t._id.month}`} className="flex flex-1 flex-col items-center gap-1">
              <div className="w-full rounded-t bg-primary" style={{ height: `${(t.count / maxTrend) * 100}%`, minHeight: 4 }} />
              <span className="text-xs text-gray-400">
                {t._id.month}/{String(t._id.year).slice(2)}
              </span>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-gray-700">Pets by species &amp; status</h2>
        <div className="space-y-1">
          {breakdown.map((b) => (
            <div key={`${b._id.species}-${b._id.status}`} className="flex items-center justify-between text-sm">
              <span className="text-gray-600">
                {b._id.species} — {b._id.status}
              </span>
              <span className="font-medium text-gray-900">{b.count}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
