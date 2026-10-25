import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Plus, Pencil, UserMinus } from "lucide-react";
import { api, getApiErrorMessage } from "../services/api";
import { PageHeader, Card } from "../components/ui/SharedUI";
import { LoadingState, ErrorState, EmptyState } from "../components/ui/StateDisplays";
import { Input, Select, FormField } from "../components/ui/FormUI";
import Button from "../components/ui/Button";
import Modal from "../components/ui/Modal";
import Alert from "../components/ui/Alert";
import StatusBadge from "../components/ui/StatusBadge";
import { useToast } from "../context/ToastContext";
import { useRealtime } from "../context/RealtimeContext";

interface Shelter { _id: string; name: string; status: string; }
interface Pet { _id: string; name: string; species: "Dog" | "Cat" | "Other"; }
interface CageAssignment { _id: string; cageId?: { _id: string } | string; pet?: { _id: string; name: string; species: string } }
interface Cage {
  _id: string;
  shelterId: Shelter | string;
  cageNumber: string;
  section?: string;
  capacity: number;
  currentOccupancy: number;
  availableCapacity: number;
  isEmpty: boolean;
  availability: string;
  status: "active" | "maintenance" | "inactive";
  quarantineOnly: boolean;
  allowedSpecies: string[];
  notes?: string;
}

const initialForm = { shelterId: "", cageNumber: "", section: "", capacity: "1", status: "active", quarantineOnly: false, allowedSpecies: ["Dog", "Cat", "Other"], notes: "" };

export default function CageManagement() {
  const { showToast } = useToast();
  const [cages, setCages] = useState<Cage[]>([]);
  const [shelters, setShelters] = useState<Shelter[]>([]);
  const [eligiblePets, setEligiblePets] = useState<Pet[]>([]);
  const [petsLoading, setPetsLoading] = useState(false);
  const [assignments, setAssignments] = useState<CageAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [editing, setEditing] = useState<Cage | null>(null);
  const [selectedCage, setSelectedCage] = useState<Cage | null>(null);
  const [form, setForm] = useState(initialForm);
  const [petId, setPetId] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Live refreshes reuse load() but skip the spinner / error banner.
  const silentRef = useRef(false);

  async function load() {
    const silent = silentRef.current;
    silentRef.current = false;
    if (!silent) { setLoading(true); setError(null); }
    try {
      const [cageRes, shelterRes, assignRes] = await Promise.all([
        api.get("/api/shelter-care/cage-definitions"),
        api.get("/api/shelters"),
        api.get("/api/shelter-care/cages"),
      ]);
      setCages(cageRes.data.data ?? []);
      setShelters(shelterRes.data.data ?? []);
      setAssignments(assignRes.data.data ?? []);
    } catch (err) { if (!silent) setError(getApiErrorMessage(err, "Failed to load cage management data")); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  const refreshSilently = useCallback(() => {
    silentRef.current = true;
    void load();
  }, []);
  useRealtime(["Cage", "CageAssignment", "Shelter", "QuarantinePeriod", "Pet"], refreshSilently);

  function openCreate() {
    setEditing(null); setForm({ ...initialForm, shelterId: shelters[0]?._id ?? "" }); setSaveError(null); setModalOpen(true);
  }
  function openEdit(cage: Cage) {
    setEditing(cage); setForm({ shelterId: typeof cage.shelterId === "string" ? cage.shelterId : cage.shelterId._id, cageNumber: cage.cageNumber, section: cage.section ?? "", capacity: String(cage.capacity), status: cage.status, quarantineOnly: cage.quarantineOnly, allowedSpecies: cage.allowedSpecies, notes: cage.notes ?? "" }); setSaveError(null); setModalOpen(true);
  }

  async function openAssign(cage: Cage) {
    setSelectedCage(cage); setPetId(""); setEligiblePets([]); setSaveError(null); setAssignOpen(true); setPetsLoading(true);
    try {
      const res = await api.get(`/api/shelter-care/cage-definitions/${cage._id}/eligible-pets`);
      setEligiblePets(res.data.data ?? []);
    } catch (err) { setSaveError(getApiErrorMessage(err, "Failed to load eligible pets")); }
    finally { setPetsLoading(false); }
  }

  async function saveCage(e: FormEvent) {
    e.preventDefault(); setSaving(true); setSaveError(null);
    try {
      const payload = { cageNumber: form.cageNumber, section: form.section, capacity: Number(form.capacity), status: form.status, quarantineOnly: form.quarantineOnly, allowedSpecies: form.allowedSpecies, notes: form.notes, ...(editing ? {} : { shelterId: form.shelterId }) };
      if (editing) await api.put(`/api/shelter-care/cage-definitions/${editing._id}`, payload);
      else await api.post("/api/shelter-care/cage-definitions", payload);
      showToast(editing ? "Cage updated" : "Cage created", "success"); setModalOpen(false); await load();
    } catch (err) { setSaveError(getApiErrorMessage(err, "Failed to save cage")); }
    finally { setSaving(false); }
  }

  async function assignPet(e: FormEvent) {
    e.preventDefault(); if (!selectedCage) return; setSaving(true); setSaveError(null);
    try {
      await api.post("/api/shelter-care/cages", { pet: petId, cageId: selectedCage._id });
      showToast("Pet assigned to cage", "success"); setAssignOpen(false); setPetId(""); await load();
    } catch (err) { setSaveError(getApiErrorMessage(err, "Failed to assign pet")); }
    finally { setSaving(false); }
  }

  async function removePet(assignmentId: string) {
    try {
      await api.delete(`/api/shelter-care/cages/${assignmentId}`);
      showToast("Pet removed from cage", "success"); await load();
    } catch (err) { showToast(getApiErrorMessage(err, "Failed to remove pet"), "error"); }
  }

  function toggleSpecies(species: string) {
    setForm((prev) => ({ ...prev, allowedSpecies: prev.allowedSpecies.includes(species) ? prev.allowedSpecies.filter((s) => s !== species) : [...prev.allowedSpecies, species] }));
  }

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={load} />;

  return <div>
    <PageHeader title="Cage Management" description="Create, identify, assign, and monitor shelter cages." actions={<Button onClick={openCreate}><Plus className="h-4 w-4" /> Add cage</Button>} />
    {cages.length === 0 ? <EmptyState title="No cages registered yet" description="Create a cage before assigning pets." /> : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {cages.map((cage) => {
        const shelterName = typeof cage.shelterId === "string" ? cage.shelterId : cage.shelterId.name;
        return <Card key={cage._id}>
          <div className="flex items-start justify-between gap-3">
            <div><h2 className="font-semibold text-gray-900">Cage {cage.cageNumber}</h2><p className="text-xs text-gray-500">{shelterName}{cage.section ? ` · ${cage.section}` : ""}</p></div>
            <StatusBadge status={cage.status === "active" ? (cage.availability === "available" ? "available" : "occupied") : cage.status} />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-sm"><div>Capacity <strong>{cage.capacity}</strong></div><div>Occupied <strong>{cage.currentOccupancy}</strong></div><div>Available <strong>{cage.availableCapacity}</strong></div><div>{cage.quarantineOnly ? "Quarantine only" : "Normal cage"}</div></div>
          <p className="mt-2 text-xs text-gray-500">Accepts: {cage.allowedSpecies.join(", ")}</p>
          {assignments.filter((a) => (typeof a.cageId === "string" ? a.cageId : a.cageId?._id) === cage._id).map((a) => <div key={a._id} className="mt-2 flex items-center justify-between rounded border border-gray-100 px-2 py-1 text-sm"><span>{a.pet?.name ?? "Assigned pet"}{a.pet?.species ? ` (${a.pet.species})` : ""}</span><Button variant="secondary" onClick={() => removePet(a._id)}><UserMinus className="h-4 w-4" /> Remove</Button></div>)}
          <div className="mt-4 flex gap-2"><Button variant="secondary" onClick={() => openEdit(cage)}><Pencil className="h-4 w-4" /> Edit</Button>{cage.availableCapacity > 0 && cage.status === "active" && <Button onClick={() => openAssign(cage)}>Assign</Button>}</div>
        </Card>;
      })}
    </div>}

    <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editing ? "Edit cage" : "Create cage"} footer={<><Button variant="secondary" onClick={() => setModalOpen(false)} disabled={saving}>Cancel</Button><Button type="submit" form="cage-form" loading={saving}>Save</Button></>}>
      <form id="cage-form" onSubmit={saveCage}>{saveError && <Alert tone="danger">{saveError}</Alert>}
        {!editing && <FormField label="Shelter" htmlFor="cage-shelter"><Select id="cage-shelter" required value={form.shelterId} onChange={(e) => setForm({ ...form, shelterId: e.target.value })}>{shelters.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}</Select></FormField>}
        <FormField label="Cage number" htmlFor="cage-number"><Input id="cage-number" required value={form.cageNumber} onChange={(e) => setForm({ ...form, cageNumber: e.target.value })} /></FormField>
        <FormField label="Section" htmlFor="cage-section"><Input id="cage-section" value={form.section} onChange={(e) => setForm({ ...form, section: e.target.value })} /></FormField>
        <FormField label="Capacity" htmlFor="cage-capacity"><Input id="cage-capacity" type="number" min={1} required value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} /></FormField>
        <FormField label="Status" htmlFor="cage-status"><Select id="cage-status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}><option value="active">Active</option><option value="maintenance">Maintenance</option><option value="inactive">Inactive</option></Select></FormField>
        <FormField label="Allowed species" htmlFor="cage-species"><div className="flex gap-3 text-sm">{["Dog", "Cat", "Other"].map((species) => <label key={species}><input type="checkbox" checked={form.allowedSpecies.includes(species)} onChange={() => toggleSpecies(species)} /> {species}</label>)}</div></FormField>
        <label className="mb-4 flex items-center gap-2 text-sm"><input type="checkbox" checked={form.quarantineOnly} onChange={(e) => setForm({ ...form, quarantineOnly: e.target.checked })} /> Quarantine-only cage</label>
        <FormField label="Notes" htmlFor="cage-notes"><Input id="cage-notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></FormField>
      </form>
    </Modal>

    <Modal isOpen={assignOpen} onClose={() => setAssignOpen(false)} title={`Assign pet to cage ${selectedCage?.cageNumber ?? ""}`} footer={<><Button variant="secondary" onClick={() => setAssignOpen(false)} disabled={saving}>Cancel</Button><Button type="submit" form="assign-form" loading={saving}>Assign</Button></>}>
      <form id="assign-form" onSubmit={assignPet}>{saveError && <Alert tone="danger">{saveError}</Alert>}<FormField label="Pet" htmlFor="cage-pet"><Select id="cage-pet" required value={petId} disabled={petsLoading} onChange={(e) => setPetId(e.target.value)}><option value="">{petsLoading ? "Loading pets..." : eligiblePets.length ? "Select pet" : "No eligible pets"}</option>{eligiblePets.map((p) => <option key={p._id} value={p._id}>{p.name} ({p.species})</option>)}</Select></FormField><p className="text-xs text-gray-500">Only pets that fit this cage are listed. The server still validates shelter, quarantine, species, capacity, and duplicate assignment rules.</p></form>
    </Modal>
  </div>;
}
