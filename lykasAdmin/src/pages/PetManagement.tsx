import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PawPrint, Search, ShieldAlert, Syringe, Stethoscope } from "lucide-react";
import { usePets, type Pet } from "../hooks/usePets";
import { api, getApiErrorMessage } from "../services/api";
import { PageHeader, Card } from "../components/ui/SharedUI";
import { LoadingState, ErrorState } from "../components/ui/StateDisplays";
import StatusBadge from "../components/ui/StatusBadge";
import Button from "../components/ui/Button";
import Alert from "../components/ui/Alert";
import { Input, Select, FormField } from "../components/ui/FormUI";
import TextArea from "../components/ui/TextArea";
import PetVideoField from "../components/pets/PetVideoField";
import { useToast } from "../context/ToastContext";

interface ShelterCareSummary {
  latestHealth: { condition: string; date: string; flagged: boolean } | null;
  latestFeeding: { meal: string; eaten: string; date: string } | null;
  activeCage: { cageNumber: string; section: string } | null;
  activeQuarantine: { reason: string; startDate: string } | null;
}

interface MedicalSummary {
  vaccinations: unknown[];
  vetVisits: unknown[];
  records: unknown[];
}

/**
 * The canonical pet detail-management screen: a master-detail view where
 * the left column lists/filters pets and the right column shows a full
 * operational profile for whichever pet is selected — editable core
 * fields plus rollups from shelter-care and medical records. This is the
 * page the original source shipped as an empty 0-line stub.
 */
export default function PetManagement() {
  const pets = usePets();
  const { showToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get("petId");

  const [selectedPet, setSelectedPet] = useState<Pet | null>(null);
  const [careSummary, setCareSummary] = useState<ShelterCareSummary | null>(null);
  const [medicalSummary, setMedicalSummary] = useState<MedicalSummary | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [status, setStatus] = useState("Available");
  const [shelterId, setShelterId] = useState("");
  // Hidden for now (shelter/cage management):
  // const [shelters, setShelters] = useState<{ _id: string; name: string; status: string; capacity: number; currentOccupancy: number }[]>([]);
  const [healthStatus, setHealthStatus] = useState("");
  const [description, setDescription] = useState("");
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [removingVideo, setRemovingVideo] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const loadDetail = useCallback(async (petId: string) => {
    setDetailLoading(true);
    setDetailError(null);
    try {
      const [petRes, careRes, medicalRes] = await Promise.all([
        api.get(`/api/pets/${petId}`),
        api.get(`/api/shelter-care/summary/${petId}`).catch(() => ({ data: { data: null } })),
        api.get(`/api/medical/summary/${petId}`).catch(() => ({ data: { data: null } })),
      ]);

      const pet: Pet = petRes.data.data;
      setSelectedPet(pet);
      setStatus(pet.status);
      setShelterId(pet.shelterId ?? "");
      setHealthStatus(pet.healthStatus ?? "");
      setDescription(pet.description ?? "");
      setVideoFile(null);
      setCareSummary(careRes.data.data);
      setMedicalSummary(medicalRes.data.data);
    } catch (err) {
      setDetailError(getApiErrorMessage(err, "Failed to load pet details"));
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    // api.get("/api/shelters").then((res) => setShelters(res.data.data ?? [])).catch(() => setShelters([]));
  }, []);

  useEffect(() => {
    if (selectedId) loadDetail(selectedId);
    else {
      setSelectedPet(null);
      setCareSummary(null);
      setMedicalSummary(null);
    }
  }, [selectedId, loadDetail]);

  async function handleSave() {
    if (!selectedPet) return;
    setSaving(true);
    setSaveError(null);
    try {
      const formData = new FormData();
      formData.append("status", status);
      formData.append("shelterId", shelterId);
      formData.append("healthStatus", healthStatus);
      formData.append("description", description);
      // Only sent when a new video was chosen; omitting it keeps the current one.
      if (videoFile) formData.append("video", videoFile);
      // Don't set Content-Type manually — axios needs to compute it
      // (including the multipart boundary) from the FormData instance.
      await api.put(`/api/pets/${selectedPet._id}`, formData);
      showToast("Pet profile updated", "success");
      loadDetail(selectedPet._id);
      pets.reload();
    } catch (err) {
      setSaveError(getApiErrorMessage(err, "Failed to save changes"));
    } finally {
      setSaving(false);
    }
  }

  async function handleRemoveVideo() {
    if (!selectedPet) return;
    setRemovingVideo(true);
    setSaveError(null);
    try {
      await api.delete(`/api/pets/${selectedPet._id}/video`);
      showToast("Video removed", "success");
      await loadDetail(selectedPet._id);
      pets.reload();
    } catch (err) {
      setSaveError(getApiErrorMessage(err, "Failed to remove video"));
    } finally {
      setRemovingVideo(false);
    }
  }

  return (
    <div>
      <PageHeader title="Pet Management" description="Select a pet to view and manage its full operational profile." />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]">
        {/* Left: pet picker */}
        <Card className="p-0">
          <div className="border-b border-gray-100 p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden="true" />
              <Input
                value={pets.search}
                onChange={(e) => pets.onSearchChange(e.target.value)}
                placeholder="Search pets…"
                className="pl-9"
                aria-label="Search pets"
              />
            </div>
          </div>
          <div className="max-h-[65vh] overflow-y-auto">
            {pets.loading ? (
              <LoadingState />
            ) : pets.rows.length === 0 ? (
              <p className="p-4 text-sm text-gray-500">No pets found.</p>
            ) : (
              pets.rows.map((pet) => (
                <button
                  key={pet._id}
                  type="button"
                  onClick={() => setSearchParams({ petId: pet._id })}
                  className={`flex w-full items-center gap-3 border-b border-gray-50 px-3 py-2.5 text-left hover:bg-gray-50 ${
                    selectedId === pet._id ? "bg-emerald-50" : ""
                  }`}
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-100">
                    <PawPrint className="h-4 w-4 text-gray-400" aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-900">{pet.name}</p>
                    <p className="truncate text-xs text-gray-500">{pet.species}{pet.breed ? ` · ${pet.breed}` : ""}</p>
                  </div>
                  <StatusBadge status={pet.status} />
                </button>
              ))
            )}
          </div>
        </Card>

        {/* Right: detail panel */}
        <div>
          {!selectedId ? (
            <Card>
              <p className="py-12 text-center text-sm text-gray-500">Select a pet from the list to manage its profile.</p>
            </Card>
          ) : detailLoading ? (
            <Card>
              <LoadingState />
            </Card>
          ) : detailError ? (
            <Card>
              <ErrorState message={detailError} onRetry={() => selectedId && loadDetail(selectedId)} />
            </Card>
          ) : selectedPet ? (
            <div className="space-y-4">
              <Card>
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-base font-semibold text-gray-900">{selectedPet.name}'s profile</h2>
                  <StatusBadge status={selectedPet.status} />
                </div>

                {saveError && (
                  <div className="mb-4">
                    <Alert tone="danger">{saveError}</Alert>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <FormField label="Status" htmlFor="pm-status">
                    <Select id="pm-status" value={status} onChange={(e) => setStatus(e.target.value)}>
                      <option value="Available">Available</option>
                      <option value="Pending">Pending</option>
                      <option value="Adopted">Adopted</option>
                      <option value="Foster">Foster</option>
                    </Select>
                  </FormField>
                  {/* Hidden for now (shelter/cage management):
                  <FormField label="Shelter" htmlFor="pm-shelter">
                    <Select id="pm-shelter" value={shelterId} onChange={(e) => setShelterId(e.target.value)}>
                      <option value="">No shelter assigned</option>
                      {shelters.map((shelter) => (
                        <option key={shelter._id} value={shelter._id} disabled={shelter.status === "inactive" || shelter.status === "under_maintenance" || (shelter.currentOccupancy >= shelter.capacity && shelter._id !== selectedPet.shelterId)}>
                          {shelter.name} ({shelter.currentOccupancy}/{shelter.capacity})
                        </option>
                      ))}
                    </Select>
                  </FormField>
                  */}

                  <FormField label="Health status" htmlFor="pm-health">
                    <Input id="pm-health" value={healthStatus} onChange={(e) => setHealthStatus(e.target.value)} />
                  </FormField>
                </div>

                <FormField label="Description" htmlFor="pm-description">
                  <TextArea id="pm-description" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
                </FormField>

                <PetVideoField
                  idPrefix="pm"
                  file={videoFile}
                  onFileChange={setVideoFile}
                  existingVideo={selectedPet.video}
                  onRemoveExisting={handleRemoveVideo}
                  removing={removingVideo}
                  uploading={saving && !!videoFile}
                  disabled={saving || removingVideo}
                />

                <div className="flex justify-end">
                  <Button onClick={handleSave} loading={saving}>
                    Save changes
                  </Button>
                </div>
              </Card>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Card>
                  <div className="mb-2 flex items-center gap-2">
                    <Stethoscope className="h-4 w-4 text-primary" aria-hidden="true" />
                    <h3 className="text-sm font-semibold text-gray-700">Shelter-floor care</h3>
                  </div>
                  {careSummary?.latestHealth ? (
                    <p className="text-sm text-gray-600">
                      Last health check: <span className="font-medium">{careSummary.latestHealth.condition}</span>
                      {careSummary.latestHealth.flagged && <span className="ml-1 text-status-danger">(flagged)</span>}
                    </p>
                  ) : (
                    <p className="text-sm text-gray-400">No health checks logged yet.</p>
                  )}
                  {careSummary?.latestFeeding && (
                    <p className="mt-1 text-sm text-gray-600">
                      Last feeding: <span className="font-medium">{careSummary.latestFeeding.meal}</span> — ate{" "}
                      {careSummary.latestFeeding.eaten}
                    </p>
                  )}
                  {/* Hidden for now (shelter/cage management):
                  {careSummary?.activeCage && (
                    <p className="mt-1 text-sm text-gray-600">
                      Cage: {careSummary.activeCage.cageNumber} ({careSummary.activeCage.section})
                    </p>
                  )}
                  */}
                  {careSummary?.activeQuarantine && (
                    <p className="mt-1 flex items-center gap-1 text-sm text-status-danger">
                      <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
                      In quarantine: {careSummary.activeQuarantine.reason}
                    </p>
                  )}
                </Card>

                <Card>
                  <div className="mb-2 flex items-center gap-2">
                    <Syringe className="h-4 w-4 text-primary" aria-hidden="true" />
                    <h3 className="text-sm font-semibold text-gray-700">Medical records</h3>
                  </div>
                  <p className="text-sm text-gray-600">{medicalSummary?.vaccinations.length ?? 0} vaccination records</p>
                  <p className="text-sm text-gray-600">{medicalSummary?.vetVisits.length ?? 0} vet visits</p>
                  <p className="text-sm text-gray-600">{medicalSummary?.records.length ?? 0} other medical records</p>
                </Card>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
