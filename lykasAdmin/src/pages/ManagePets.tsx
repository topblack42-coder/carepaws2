import { useEffect, useState } from "react";
import { Plus, Pencil, Archive, RotateCcw } from "lucide-react";
import { usePets, type Pet } from "../hooks/usePets";
import { PageHeader } from "../components/ui/SharedUI";
import Button from "../components/ui/Button";
import DataTable, { type Column } from "../components/ui/DataTable";
import StatusBadge from "../components/ui/StatusBadge";
import ConfirmModal from "../components/ui/ConfirmModal";
import AddPetModal from "../components/pets/AddPetModal";
import EditPetModal from "../components/pets/EditPetModal";
import type { ShelterOption } from "../components/pets/PetFields";
import { api } from "../services/api";
import { useToast } from "../context/ToastContext";
import IconButton from "../components/ui/IconButton";

export default function ManagePets() {
  const pets = usePets();
  const { showToast } = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<Pet | null>(null);
  const [archiving, setArchiving] = useState<Pet | null>(null);
  const [shelters, setShelters] = useState<ShelterOption[]>([]);

  // Shelter choices for the Add/Edit forms. Optional — the forms still work if this fails.
  useEffect(() => {
    let cancelled = false;
    api
      .get("/api/shelters", { params: { limit: "100" } })
      .then((res) => {
        if (!cancelled) setShelters((res.data?.data ?? []).map((s: ShelterOption) => ({ _id: s._id, name: s.name })));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const columns: Column<Pet>[] = [
    {
      key: "name",
      header: "Name",
      accessor: (p) => (
        <span className="flex items-center gap-3">
          {p.imageUrl ? (
            <img src={p.imageUrl} alt="" className="h-9 w-9 rounded-lg object-cover" />
          ) : (
            <span className="h-9 w-9 rounded-lg bg-gray-100" aria-hidden="true" />
          )}
          <span className="font-medium text-gray-900">{p.name}</span>
        </span>
      ),
    },
    { key: "species", header: "Species", accessor: (p) => p.species },
    { key: "breed", header: "Breed", accessor: (p) => p.breed || "—" },
    { key: "status", header: "Status", accessor: (p) => <StatusBadge status={p.isDeleted ? "archived" : p.status} /> },
  ];

  return (
    <div>
      <PageHeader
        title="Manage Pets"
        description="Add, edit, archive, and restore pets in the shelter's catalog."
        actions={
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add pet
          </Button>
        }
      />

      <DataTable
        columns={columns}
        rows={pets.rows}
        rowKey={(p) => p._id}
        loading={pets.loading}
        error={pets.error}
        onRetry={pets.reload}
        emptyTitle="No pets yet"
        emptyDescription="Add your first pet to get started."
        searchValue={pets.search}
        onSearchChange={pets.onSearchChange}
        searchPlaceholder="Search by name or breed…"
        filters={[
          { key: "species", label: "Species", options: [{ value: "Dog", label: "Dog" }, { value: "Cat", label: "Cat" }, { value: "Other", label: "Other" }] },
          {
            key: "status",
            label: "Status",
            options: [
              { value: "Available", label: "Available" },
              { value: "Pending", label: "Pending" },
              { value: "Adopted", label: "Adopted" },
              { value: "Foster", label: "Foster" },
            ],
          },
        ]}
        filterValues={pets.filters}
        onFilterChange={pets.onFilterChange}
        page={pets.pagination.page}
        pages={pets.pagination.pages}
        total={pets.pagination.total}
        onPageChange={pets.setPage}
        rowActions={(pet) => (
          <div className="flex justify-end gap-1">
            <IconButton label={`Edit ${pet.name}`} onClick={() => setEditing(pet)}>
              <Pencil className="h-4 w-4" />
            </IconButton>
            {pet.isDeleted ? (
              <IconButton label={`Restore ${pet.name}`} disabled={pets.mutating} onClick={async () => {
                  const ok = await pets.restorePet(pet._id);
                  if (ok) showToast("Pet restored", "success");
                }}>
                <RotateCcw className="h-4 w-4" />
              </IconButton>
            ) : (
              <IconButton label={`Archive ${pet.name}`} onClick={() => setArchiving(pet)}>
                <Archive className="h-4 w-4" />
              </IconButton>
            )}
          </div>
        )}
      />

      <AddPetModal
        isOpen={addOpen}
        onClose={() => setAddOpen(false)}
        onSubmit={async (formData) => {
          const ok = await pets.createPet(formData);
          if (ok) showToast("Pet added", "success");
          return ok;
        }}
        shelters={shelters}
        mutating={pets.mutating}
        mutationError={pets.mutationError}
      />

      <EditPetModal
        pet={editing}
        onClose={() => setEditing(null)}
        onSubmit={async (id, formData) => {
          const ok = await pets.updatePet(id, formData);
          if (ok) showToast("Pet updated", "success");
          return ok;
        }}
        onRemoveVideo={async (id) => {
          const ok = await pets.removePetVideo(id);
          if (ok) showToast("Video removed", "success");
          return ok;
        }}
        shelters={shelters}
        mutating={pets.mutating}
        mutationError={pets.mutationError}
      />

      <ConfirmModal
        isOpen={!!archiving}
        title="Archive this pet?"
        message={`${archiving?.name ?? "This pet"} will be hidden from the public catalog but can be restored later.`}
        confirmLabel="Archive"
        variant="danger"
        loading={pets.mutating}
        onConfirm={async () => {
          if (!archiving) return;
          const ok = await pets.deletePet(archiving._id);
          if (ok) showToast("Pet archived", "success");
          setArchiving(null);
        }}
        onCancel={() => setArchiving(null)}
      />
    </div>
  );
}
