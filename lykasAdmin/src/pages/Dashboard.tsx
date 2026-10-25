import { useCallback, useEffect, useState } from "react";
import { PawPrint, FileText, HandHeart, DollarSign, Building2 } from "lucide-react";
import { api, getApiErrorMessage } from "../services/api";
import { PageHeader, StatCard, Card } from "../components/ui/SharedUI";
import { LoadingState, ErrorState } from "../components/ui/StateDisplays";
import { useRealtime } from "../context/RealtimeContext";

interface DashboardData {
  petsByStatus: { _id: string; count: number }[];
  pendingApplications: number;
  pendingVolunteers: number;
  revenueThisMonthCentavos: number;
  shelterStats: { count: number; totalCapacity: number; totalOccupancy: number; availableCapacity: number; occupancyPercentage: number };
}

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .get("/api/dashboard")
      .then((res) => {
        if (!cancelled) setData(res.data.data);
      })
      .catch((err) => {
        if (!cancelled) setError(getApiErrorMessage(err, "Failed to load dashboard"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Live refresh: swap in fresh numbers quietly; keep the old ones on failure.
  const refreshSilently = useCallback(() => {
    api
      .get("/api/dashboard")
      .then((res) => setData(res.data.data))
      .catch(() => {});
  }, []);
  useRealtime(["Pet", "Application", "Volunteer", "Payment", "Shelter", "Cage", "CageAssignment"], refreshSilently);

  if (loading) return <LoadingState label="Loading dashboard…" />;
  if (error || !data) return <ErrorState message={error ?? "No data"} />;

  const totalPets = data.petsByStatus.reduce((sum, s) => sum + s.count, 0);
  const availableCount = data.petsByStatus.find((s) => s._id === "Available")?.count ?? 0;
  const revenue = (data.revenueThisMonthCentavos / 100).toLocaleString(undefined, { style: "currency", currency: "PHP" });

  return (
    <div>
      <PageHeader title="Dashboard" description="A snapshot of what's happening at the shelter right now." />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total pets" value={totalPets} hint={`${availableCount} available`} />
        <StatCard label="Pending applications" value={data.pendingApplications} />
        <StatCard label="Pending volunteer applications" value={data.pendingVolunteers} />
        <StatCard label="Shelter occupancy" value={`${data.shelterStats.totalOccupancy}/${data.shelterStats.totalCapacity}`} hint={`${data.shelterStats.occupancyPercentage}% · ${data.shelterStats.availableCapacity} spaces available`} />
      </div>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-gray-700">Pets by status</h2>
        <div className="space-y-2">
          {data.petsByStatus.map((s) => (
            <div key={s._id} className="flex items-center gap-3">
              <PawPrint className="h-4 w-4 text-gray-400" aria-hidden="true" />
              <span className="w-24 text-sm text-gray-600">{s._id}</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${totalPets ? (s.count / totalPets) * 100 : 0}%` }}
                />
              </div>
              <span className="w-8 text-right text-sm font-medium text-gray-700">{s.count}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card className="mt-4">
        <div className="flex items-center gap-3">
          <Building2 className="h-5 w-5 text-primary" aria-hidden="true" />
          <div>
            <p className="text-sm text-gray-500">Shelter capacity</p>
            <p className="text-lg font-semibold text-gray-900">{data.shelterStats.totalOccupancy} occupied of {data.shelterStats.totalCapacity}</p>
            <p className="text-sm text-gray-500">{data.shelterStats.availableCapacity} available spaces across {data.shelterStats.count} shelters</p>
          </div>
        </div>
      </Card>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="flex items-center gap-3">
          <FileText className="h-5 w-5 text-primary" aria-hidden="true" />
          <div>
            <p className="text-sm text-gray-500">Applications awaiting review</p>
            <p className="text-lg font-semibold text-gray-900">{data.pendingApplications}</p>
          </div>
        </Card>
        <Card className="flex items-center gap-3">
          <HandHeart className="h-5 w-5 text-primary" aria-hidden="true" />
          <div>
            <p className="text-sm text-gray-500">Volunteers awaiting approval</p>
            <p className="text-lg font-semibold text-gray-900">{data.pendingVolunteers}</p>
          </div>
        </Card>
        <Card className="flex items-center gap-3">
          <DollarSign className="h-5 w-5 text-primary" aria-hidden="true" />
          <div>
            <p className="text-sm text-gray-500">Revenue this month</p>
            <p className="text-lg font-semibold text-gray-900">{revenue}</p>
          </div>
        </Card>
      </div>
    </div>
  );
}
