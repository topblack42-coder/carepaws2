import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { Syringe, Stethoscope, BookHeart, Plus, ShieldAlert, Utensils, Activity, BedDouble } from "lucide-react";
import { api, getApiErrorMessage } from "../services/api";
import { usePets } from "../hooks/usePets";
import { useRealtime } from "../context/RealtimeContext";
import { PageHeader, Card } from "../components/ui/SharedUI";
import { LoadingState, ErrorState, EmptyState } from "../components/ui/StateDisplays";
import { Input, Select, FormField } from "../components/ui/FormUI";
import TextArea from "../components/ui/TextArea";
import Button from "../components/ui/Button";
import Modal from "../components/ui/Modal";
import Alert from "../components/ui/Alert";
import { useToast } from "../context/ToastContext";

interface MedicalSummary {
  vaccinations: { _id: string; vaccineName: string; dateGiven: string; nextDueDate?: string }[];
  vetVisits: { _id: string; visitDate: string; reason: string }[];
  records: { _id: string; type: string; date: string; description: string }[];
}

interface ShelterCareSummary {
  latestHealth: { condition: string; date: string; weight?: number; temperature?: number; flagged: boolean } | null;
  latestFeeding: { meal: string; eaten: string; date: string; foodType?: string } | null;
  latestBehavior: { mood: string; sociability: string; date: string; flagged: boolean } | null;
  activeCage: { cageNumber: string; section?: string } | null;
  activeQuarantine: { reason: string; startDate: string } | null;
}

// One entry per record type this screen can create. Each maps to a
// shelter-care or medical-record POST endpoint (backend routes) with
// the fields that endpoint's zod schema accepts.
type RecordType =
  | "healthCheck"
  | "feedingLog"
  | "behavioralObs"
  | "cage"
  | "quarantine"
  | "vaccination"
  | "vetVisit"
  | "generalRecord";

const RECORD_TYPE_OPTIONS: { value: RecordType; label: string }[] = [
  { value: "healthCheck", label: "Health check" },
  { value: "feedingLog", label: "Feeding log" },
  { value: "behavioralObs", label: "Behavioral observation" },
  { value: "cage", label: "Cage assignment" },
  { value: "quarantine", label: "Start quarantine" },
  { value: "vaccination", label: "Vaccination" },
  { value: "vetVisit", label: "Vet visit" },
  { value: "generalRecord", label: "Other medical record" },
];

const ENDPOINTS: Record<RecordType, string> = {
  healthCheck: "/api/shelter-care/health-checks",
  feedingLog: "/api/shelter-care/feeding-logs",
  behavioralObs: "/api/shelter-care/behavioral-obs",
  cage: "/api/shelter-care/cages",
  quarantine: "/api/shelter-care/quarantine",
  vaccination: "/api/medical/vaccinations",
  vetVisit: "/api/medical/vet-visits",
  generalRecord: "/api/medical/records",
};

const NUMBER_FIELDS = new Set(["weight", "temperature", "cost"]);

function defaultFormForType(type: RecordType): Record<string, string> {
  switch (type) {
    case "healthCheck":
      return { condition: "Good", weight: "", temperature: "", notes: "" };
    case "feedingLog":
      return { meal: "Morning", foodType: "", amount: "", eaten: "All", notes: "" };
    case "behavioralObs":
      return { mood: "Calm", sociability: "Friendly", notes: "" };
    case "cage":
      return { cageId: "", cageNumber: "", section: "", notes: "" };
    case "quarantine":
      return { startDate: new Date().toISOString().slice(0, 10), reason: "", notes: "" };
    case "vaccination":
      return { vaccineName: "", dateGiven: new Date().toISOString().slice(0, 10), nextDueDate: "", administeredBy: "" };
    case "vetVisit":
      return { visitDate: new Date().toISOString().slice(0, 10), reason: "", vetName: "", clinic: "", diagnosis: "", treatment: "" };
    case "generalRecord":
      return { type: "Other", date: new Date().toISOString().slice(0, 10), description: "" };
    default:
      return {};
  }
}

export default function Health() {
  const pets = usePets();
  const { showToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const petId = searchParams.get("petId");

  const [summary, setSummary] = useState<MedicalSummary | null>(null);
  const [careSummary, setCareSummary] = useState<ShelterCareSummary | null>(null);
  const [babyBook, setBabyBook] = useState<
    { _id: string; title: string; content?: string; date: string; category: string; photoUrl?: string | null }[]
  >([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [recordType, setRecordType] = useState<RecordType>("healthCheck");
  const [form, setForm] = useState<Record<string, string>>(defaultFormForType("healthCheck"));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [availableCages, setAvailableCages] = useState<{ _id: string; cageNumber: string; section?: string; capacity: number; currentOccupancy: number; quarantineOnly: boolean }[]>([]);

  // Live refreshes reuse load() but skip the spinner / error banner.
  const silentRef = useRef(false);

  const load = useCallback(() => {
    if (!petId) return;
    let cancelled = false;
    const silent = silentRef.current;
    silentRef.current = false;
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    Promise.all([
      api.get(`/api/medical/summary/${petId}`),
      api.get(`/api/baby-book/${petId}`),
      api.get(`/api/shelter-care/summary/${petId}`),
    ])
      .then(([medicalRes, babyBookRes, careRes]) => {
        if (cancelled) return;
        setSummary(medicalRes.data.data);
        setBabyBook(babyBookRes.data.data);
        setCareSummary(careRes.data.data);
      })
      .catch((err) => {
        if (!cancelled && !silent) setError(getApiErrorMessage(err, "Failed to load health records"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [petId]);

  useEffect(() => {
    load();
  }, [load]);

  const refreshSilently = useCallback(() => {
    silentRef.current = true;
    load();
  }, [load]);
  useRealtime(
    ["Vaccination", "VetVisit", "GeneralMedicalRecord", "HealthCheck", "FeedingLog", "BehavioralObservation", "BabyBook", "CageAssignment", "QuarantinePeriod", "Pet"],
    refreshSilently
  );

  function openAdd(type: RecordType) {
    setRecordType(type);
    setForm(defaultFormForType(type));
    setSaveError(null);
    setAddOpen(true);
  }

  function updateField(key: string, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!petId) return;
    setSaving(true);
    setSaveError(null);
    try {
      const payload: Record<string, unknown> = { pet: petId };
      for (const [key, value] of Object.entries(form)) {
        if (value === "") continue; // omit empty optionals so zod .optional() fields don't fail
        payload[key] = NUMBER_FIELDS.has(key) ? Number(value) : value;
      }
      await api.post(ENDPOINTS[recordType], payload);
      showToast("Record added", "success");
      setAddOpen(false);
      load();
    } catch (err) {
      setSaveError(getApiErrorMessage(err, "Failed to save record"));
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    if (recordType !== "cage" || !petId) { setAvailableCages([]); return; }
    api.get(`/api/shelter-care/cage-definitions`, { params: { petId } })
      .then((res) => setAvailableCages(res.data.data ?? []))
      .catch(() => setAvailableCages([]));
  }, [recordType, petId]);

  async function endQuarantine() {
    if (!petId || !careSummary?.activeQuarantine) return;
    try {
      // The summary rollup doesn't include the quarantine record's _id, so
      // fetch the active one directly to get it before ending it.
      const res = await api.get(`/api/shelter-care/quarantine/${petId}`);
      const active = (res.data.data as { _id: string; isActive: boolean }[]).find((q) => q.isActive);
      if (!active) return;
      await api.put(`/api/shelter-care/quarantine/${active._id}/end`);
      showToast("Quarantine ended", "success");
      load();
    } catch (err) {
      showToast(getApiErrorMessage(err, "Failed to end quarantine"), "error");
    }
  }

  const formFields = recordFieldsForType(recordType, availableCages);

  return (
    <div>
      <PageHeader title="Health & Baby Book" description="Medical timeline, shelter-floor care, and photo/growth journal per pet." />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_1fr]">
        <Card className="p-0">
          <div className="border-b border-gray-100 p-3">
            <Input value={pets.search} onChange={(e) => pets.onSearchChange(e.target.value)} placeholder="Search pets…" />
          </div>
          <div className="max-h-[65vh] overflow-y-auto">
            {pets.rows.map((pet) => (
              <button
                key={pet._id}
                type="button"
                onClick={() => setSearchParams({ petId: pet._id })}
                className={`block w-full border-b border-gray-50 px-3 py-2.5 text-left text-sm hover:bg-gray-50 ${petId === pet._id ? "bg-emerald-50 font-medium" : "text-gray-700"}`}
              >
                {pet.name} <span className="text-xs text-gray-400">({pet.species})</span>
              </button>
            ))}
          </div>
        </Card>

        <div>
          {!petId ? (
            <Card>
              <p className="py-12 text-center text-sm text-gray-500">Select a pet to view its health timeline.</p>
            </Card>
          ) : loading ? (
            <Card>
              <LoadingState />
            </Card>
          ) : error ? (
            <Card>
              <ErrorState message={error} onRetry={load} />
            </Card>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-gray-500">Add a new record for this pet.</p>
                <div className="flex flex-wrap gap-2">
                  {RECORD_TYPE_OPTIONS.map((opt) => (
                    <Button key={opt.value} variant="secondary" onClick={() => openAdd(opt.value)}>
                      <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                      {opt.label}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Card>
                  <div className="mb-2 flex items-center gap-2">
                    <Activity className="h-4 w-4 text-primary" aria-hidden="true" />
                    <h3 className="text-sm font-semibold text-gray-700">Latest health check</h3>
                  </div>
                  {careSummary?.latestHealth ? (
                    <div className="text-sm text-gray-600">
                      <p>
                        Condition: <span className="font-medium">{careSummary.latestHealth.condition}</span>
                        {careSummary.latestHealth.flagged && <span className="ml-1 text-status-danger">(flagged)</span>}
                      </p>
                      {careSummary.latestHealth.weight != null && <p>Weight: {careSummary.latestHealth.weight} kg</p>}
                      {careSummary.latestHealth.temperature != null && <p>Temperature: {careSummary.latestHealth.temperature}°C</p>}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-400">No health checks logged yet.</p>
                  )}
                </Card>

                <Card>
                  <div className="mb-2 flex items-center gap-2">
                    <Utensils className="h-4 w-4 text-primary" aria-hidden="true" />
                    <h3 className="text-sm font-semibold text-gray-700">Latest feeding</h3>
                  </div>
                  {careSummary?.latestFeeding ? (
                    <p className="text-sm text-gray-600">
                      {careSummary.latestFeeding.meal} — ate {careSummary.latestFeeding.eaten}
                      {careSummary.latestFeeding.foodType ? ` (${careSummary.latestFeeding.foodType})` : ""}
                    </p>
                  ) : (
                    <p className="text-sm text-gray-400">No feeding logs yet.</p>
                  )}
                </Card>

                <Card>
                  <div className="mb-2 flex items-center gap-2">
                    <BedDouble className="h-4 w-4 text-primary" aria-hidden="true" />
                    <h3 className="text-sm font-semibold text-gray-700">Cage & quarantine</h3>
                  </div>
                  {careSummary?.activeCage ? (
                    <p className="text-sm text-gray-600">
                      Cage {careSummary.activeCage.cageNumber}
                      {careSummary.activeCage.section ? ` (${careSummary.activeCage.section})` : ""}
                    </p>
                  ) : (
                    <p className="text-sm text-gray-400">No active cage assignment.</p>
                  )}
                  {careSummary?.activeQuarantine ? (
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <p className="flex items-center gap-1 text-sm text-status-danger">
                        <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
                        In quarantine: {careSummary.activeQuarantine.reason}
                      </p>
                      <button type="button" onClick={endQuarantine} className="text-xs text-primary hover:underline">
                        End
                      </button>
                    </div>
                  ) : (
                    <p className="mt-1 text-sm text-gray-400">Not in quarantine.</p>
                  )}
                </Card>

                <Card>
                  <div className="mb-2 flex items-center gap-2">
                    <BookHeart className="h-4 w-4 text-primary" aria-hidden="true" />
                    <h3 className="text-sm font-semibold text-gray-700">Latest behavior</h3>
                  </div>
                  {careSummary?.latestBehavior ? (
                    <p className="text-sm text-gray-600">
                      Mood: {careSummary.latestBehavior.mood} · Sociability: {careSummary.latestBehavior.sociability}
                      {careSummary.latestBehavior.flagged && <span className="ml-1 text-status-danger">(flagged)</span>}
                    </p>
                  ) : (
                    <p className="text-sm text-gray-400">No behavioral observations yet.</p>
                  )}
                </Card>
              </div>

              <Card>
                <div className="mb-2 flex items-center gap-2">
                  <Syringe className="h-4 w-4 text-primary" aria-hidden="true" />
                  <h3 className="text-sm font-semibold text-gray-700">Vaccinations</h3>
                </div>
                {!summary?.vaccinations.length ? (
                  <EmptyState title="No vaccination records" />
                ) : (
                  summary.vaccinations.map((v) => (
                    <p key={v._id} className="py-1 text-sm text-gray-600">
                      {v.vaccineName} — given {new Date(v.dateGiven).toLocaleDateString()}
                      {v.nextDueDate && `, next due ${new Date(v.nextDueDate).toLocaleDateString()}`}
                    </p>
                  ))
                )}
              </Card>

              <Card>
                <div className="mb-2 flex items-center gap-2">
                  <Stethoscope className="h-4 w-4 text-primary" aria-hidden="true" />
                  <h3 className="text-sm font-semibold text-gray-700">Vet visits</h3>
                </div>
                {!summary?.vetVisits.length ? (
                  <EmptyState title="No vet visits recorded" />
                ) : (
                  summary.vetVisits.map((v) => (
                    <p key={v._id} className="py-1 text-sm text-gray-600">
                      {new Date(v.visitDate).toLocaleDateString()} — {v.reason}
                    </p>
                  ))
                )}
              </Card>

              <Card>
                <div className="mb-2 flex items-center gap-2">
                  <Stethoscope className="h-4 w-4 text-primary" aria-hidden="true" />
                  <h3 className="text-sm font-semibold text-gray-700">Other medical records</h3>
                </div>
                {!summary?.records.length ? (
                  <EmptyState title="No other medical records" />
                ) : (
                  summary.records.map((r) => (
                    <p key={r._id} className="py-1 text-sm text-gray-600">
                      {new Date(r.date).toLocaleDateString()} — {r.type}
                      {r.description ? `: ${r.description}` : ""}
                    </p>
                  ))
                )}
              </Card>

              <Card>
                <div className="mb-2 flex items-center gap-2">
                  <BookHeart className="h-4 w-4 text-primary" aria-hidden="true" />
                  <h3 className="text-sm font-semibold text-gray-700">Baby book</h3>
                </div>
                {babyBook.length === 0 ? (
                  <EmptyState title="No baby book entries yet" />
                ) : (
                  babyBook.map((entry) => (
                    <div key={entry._id} className="flex gap-3 py-1.5">
                      {entry.photoUrl && (
                        <img src={entry.photoUrl} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" />
                      )}
                      <div>
                        <p className="text-sm text-gray-600">
                          {new Date(entry.date).toLocaleDateString()} — {entry.title}{" "}
                          <span className="text-xs text-gray-400">({entry.category})</span>
                        </p>
                        {entry.content && <p className="text-xs text-gray-400">{entry.content}</p>}
                      </div>
                    </div>
                  ))
                )}
              </Card>
            </div>
          )}
        </div>
      </div>

      <Modal
        isOpen={addOpen}
        onClose={() => setAddOpen(false)}
        title={RECORD_TYPE_OPTIONS.find((o) => o.value === recordType)?.label ?? "Add record"}
        footer={
          <>
            <Button variant="secondary" onClick={() => setAddOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" form="add-record-form" loading={saving}>
              Save
            </Button>
          </>
        }
      >
        <form id="add-record-form" onSubmit={handleSave}>
          {saveError && (
            <div className="mb-4">
              <Alert tone="danger">{saveError}</Alert>
            </div>
          )}

          <FormField label="Record type" htmlFor="record-type">
            <Select
              id="record-type"
              value={recordType}
              onChange={(e) => {
                const next = e.target.value as RecordType;
                setRecordType(next);
                setForm(defaultFormForType(next));
              }}
            >
              {RECORD_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </Select>
          </FormField>

          {formFields.map((field) => (
            <FormField key={field.key} label={field.label} htmlFor={`field-${field.key}`}>
              {field.type === "select" ? (
                <Select id={`field-${field.key}`} value={form[field.key] ?? ""} onChange={(e) => updateField(field.key, e.target.value)}>
                  {field.key === "cageId" ? availableCages.map((cage) => (
                    <option key={cage._id} value={cage._id}>
                      Cage {cage.cageNumber}{cage.section ? ` · ${cage.section}` : ""}
                    </option>
                  )) : field.options!.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </Select>
              ) : field.type === "textarea" ? (
                <TextArea
                  id={`field-${field.key}`}
                  rows={2}
                  value={form[field.key] ?? ""}
                  onChange={(e) => updateField(field.key, e.target.value)}
                />
              ) : (
                <Input
                  id={`field-${field.key}`}
                  type={field.type}
                  required={field.required}
                  value={form[field.key] ?? ""}
                  onChange={(e) => updateField(field.key, e.target.value)}
                />
              )}
            </FormField>
          ))}
        </form>
      </Modal>
    </div>
  );
}

interface FieldSpec {
  key: string;
  label: string;
  type: "text" | "number" | "date" | "select" | "textarea";
  options?: string[];
  required?: boolean;
}

function recordFieldsForType(type: RecordType, availableCages: { _id: string; cageNumber: string; section?: string }[] = []): FieldSpec[] {
  switch (type) {
    case "healthCheck":
      return [
        { key: "condition", label: "Condition", type: "select", options: ["Excellent", "Good", "Fair", "Poor", "Critical"], required: true },
        { key: "weight", label: "Weight (kg)", type: "number" },
        { key: "temperature", label: "Temperature (°C)", type: "number" },
        { key: "notes", label: "Notes", type: "textarea" },
      ];
    case "feedingLog":
      return [
        { key: "meal", label: "Meal", type: "select", options: ["Morning", "Afternoon", "Evening"], required: true },
        { key: "foodType", label: "Food type", type: "text" },
        { key: "amount", label: "Amount", type: "text" },
        { key: "eaten", label: "Amount eaten", type: "select", options: ["All", "Most", "Half", "Little", "None"] },
        { key: "notes", label: "Notes", type: "textarea" },
      ];
    case "behavioralObs":
      return [
        { key: "mood", label: "Mood", type: "select", options: ["Happy", "Calm", "Anxious", "Aggressive", "Lethargic", "Playful"], required: true },
        { key: "sociability", label: "Sociability", type: "select", options: ["Friendly", "Neutral", "Shy", "Aggressive"], required: true },
        { key: "notes", label: "Notes", type: "textarea" },
      ];
    case "cage":
      return [
        { key: "cageId", label: "Cage", type: "select", options: availableCages.map((cage) => `${cage._id}|Cage ${cage.cageNumber}${cage.section ? ` · ${cage.section}` : ""}`), required: true },
        { key: "notes", label: "Notes", type: "textarea" },
      ];
    case "quarantine":
      return [
        { key: "startDate", label: "Start date", type: "date", required: true },
        { key: "reason", label: "Reason", type: "text", required: true },
        { key: "notes", label: "Notes", type: "textarea" },
      ];
    case "vaccination":
      return [
        { key: "vaccineName", label: "Vaccine name", type: "text", required: true },
        { key: "dateGiven", label: "Date given", type: "date", required: true },
        { key: "nextDueDate", label: "Next due date", type: "date" },
        { key: "administeredBy", label: "Administered by", type: "text" },
      ];
    case "vetVisit":
      return [
        { key: "visitDate", label: "Visit date", type: "date", required: true },
        { key: "reason", label: "Reason", type: "text", required: true },
        { key: "vetName", label: "Vet name", type: "text" },
        { key: "clinic", label: "Clinic", type: "text" },
        { key: "diagnosis", label: "Diagnosis", type: "textarea" },
        { key: "treatment", label: "Treatment", type: "textarea" },
      ];
    case "generalRecord":
      return [
        {
          key: "type",
          label: "Type",
          type: "select",
          options: ["Surgery", "Deworming", "Flea Treatment", "Dental", "Spay/Neuter", "Injury", "Illness", "Other"],
          required: true,
        },
        { key: "date", label: "Date", type: "date", required: true },
        { key: "description", label: "Description", type: "textarea" },
      ];
    default:
      return [];
  }
}
