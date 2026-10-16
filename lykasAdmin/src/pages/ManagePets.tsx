import { useState } from "react";
import { Plus, Pencil, Archive } from "lucide-react";
import { usePets, type Pet } from "../hooks/usePets";
import { PageHeader } from "../components/ui/SharedUI";
import Button from "../components/ui/Button";
import DataTable, { type Column } from "../components/ui/DataTable";
import StatusBadge from "../components/ui/StatusBadge";
import ConfirmModal from "../components/ui/ConfirmModal";
import AddPetModal from "../components/pets/AddPetModal";
import EditPetModal from "../components/pets/EditPetModal";
import { useToast } from "../context/ToastContext";

export default function ManagePets() {
  const pets = usePets();
  const { showToast } = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<Pet | null>(null);
  const [archiving, setArchiving] = useState<Pet | null>(null);

  const columns: Column<Pet>[] = [
    { key: "name", header: "Name", accessor: (p) => <span className="font-medium text-gray-900">{p.name}</span> },
    { key: "species", header: "Species", accessor: (p) => p.species },
    { key: "breed", header: "Breed", accessor: (p) => p.breed || "—" },
    { key: "status", header: "Status", accessor: (p) => <StatusBadge status={p.status} /> },
  ];

  return (
    <div>
      <PageHeader
        title="Manage Pets"
        description="Add, edit, and archive pets in the shelter's catalog."
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
            <button
              type="button"
              onClick={() => setEditing(pet)}
              className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100"
              aria-label={`Edit ${pet.name}`}
            >
              <Pencil className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setArchiving(pet)}
              className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100"
              aria-label={`Archive ${pet.name}`}
            >
              <Archive className="h-4 w-4" />
            </button>
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
