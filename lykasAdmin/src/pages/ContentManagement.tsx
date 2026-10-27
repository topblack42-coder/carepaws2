import { useState, type FormEvent } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { useResourceList } from "../hooks/useResourceList";
import { api, getApiErrorMessage } from "../services/api";
import { PageHeader } from "../components/ui/SharedUI";
import DataTable, { type Column } from "../components/ui/DataTable";
import StatusBadge from "../components/ui/StatusBadge";
import Button from "../components/ui/Button";
import Modal from "../components/ui/Modal";
import ConfirmModal from "../components/ui/ConfirmModal";
import Alert from "../components/ui/Alert";
import { FormField, Input, Select } from "../components/ui/FormUI";
import TextArea from "../components/ui/TextArea";
import { useToast } from "../context/ToastContext";
import IconButton from "../components/ui/IconButton";

interface ContentItem {
  _id: string;
  type: string;
  title: string;
  isPublished: boolean;
  slug?: string;
}

export default function ContentManagement() {
  const list = useResourceList<ContentItem>("/api/content");
  const { showToast } = useToast();
  const [editing, setEditing] = useState<ContentItem | "new" | null>(null);
  const [title, setTitle] = useState("");
  const [type, setType] = useState("faq");
  const [body, setBody] = useState("");
  const [isPublished, setIsPublished] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<ContentItem | null>(null);
  const [deletingBusy, setDeletingBusy] = useState(false);

  function openEdit(item: ContentItem | "new") {
    setEditing(item);
    if (item === "new") {
      setTitle("");
      setType("faq");
      setBody("");
      setIsPublished(false);
    } else {
      setTitle(item.title);
      setType(item.type);
      setIsPublished(item.isPublished);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      if (editing === "new") {
        await api.post("/api/content", { title, type, body, isPublished });
        showToast("Content created", "success");
      } else if (editing) {
        await api.put(`/api/content/${editing._id}`, { title, type, body, isPublished });
        showToast("Content updated", "success");
      }
      setEditing(null);
      list.reload();
    } catch (err) {
      setError(getApiErrorMessage(err, "Failed to save content"));
    } finally {
      setSaving(false);
    }
  }

  const columns: Column<ContentItem>[] = [
    { key: "title", header: "Title", accessor: (c) => c.title },
    { key: "type", header: "Type", accessor: (c) => <span className="capitalize">{c.type}</span> },
    { key: "isPublished", header: "Status", accessor: (c) => <StatusBadge status={c.isPublished ? "active" : "draft"} /> },
  ];

  return (
    <div>
      <PageHeader
        title="Content"
        description="FAQs, policies, and pages shown in the mobile app."
        actions={
          <Button onClick={() => openEdit("new")}>
            <Plus className="h-4 w-4" aria-hidden="true" /> New content
          </Button>
        }
      />
      <DataTable
        columns={columns}
        rows={list.rows}
        rowKey={(c) => c._id}
        loading={list.loading}
        error={list.error}
        onRetry={list.reload}
        emptyTitle="No content yet"
        searchValue={list.search}
        onSearchChange={list.onSearchChange}
        filters={[{ key: "type", label: "Type", options: ["faq", "policy", "page", "announcement"].map((t) => ({ value: t, label: t })) }]}
        filterValues={list.filters}
        onFilterChange={list.onFilterChange}
        page={list.pagination.page}
        pages={list.pagination.pages}
        total={list.pagination.total}
        onPageChange={list.setPage}
        rowActions={(c) => (
          <div className="flex justify-end gap-1">
            <IconButton label="Edit" onClick={() => openEdit(c)}>
              <Pencil className="h-4 w-4" />
            </IconButton>
            <IconButton label="Delete" onClick={() => setDeleting(c)}>
              <Trash2 className="h-4 w-4" />
            </IconButton>
          </div>
        )}
      />

      <ConfirmModal
        isOpen={!!deleting}
        title="Delete this content?"
        message={`"${deleting?.title ?? ""}" will be removed${deleting?.isPublished ? " and will no longer be visible to the public" : ""}.`}
        confirmLabel="Delete"
        variant="danger"
        loading={deletingBusy}
        onConfirm={async () => {
          if (!deleting) return;
          setDeletingBusy(true);
          try {
            await api.delete(`/api/content/${deleting._id}`);
            showToast("Content deleted", "success");
            setDeleting(null);
            list.reload();
          } catch (err) {
            showToast(getApiErrorMessage(err, "Failed to delete content"), "error");
          } finally {
            setDeletingBusy(false);
          }
        }}
        onCancel={() => setDeleting(null)}
      />

      <Modal
        isOpen={!!editing}
        onClose={() => setEditing(null)}
        title={editing === "new" ? "New content" : "Edit content"}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" form="content-form" loading={saving}>
              Save
            </Button>
          </>
        }
      >
        <form id="content-form" onSubmit={handleSubmit}>
          {error && (
            <div className="mb-4">
              <Alert tone="danger">{error}</Alert>
            </div>
          )}
          <FormField label="Title" htmlFor="content-title">
            <Input id="content-title" required value={title} onChange={(e) => setTitle(e.target.value)} />
          </FormField>
          <FormField label="Type" htmlFor="content-type">
            <Select id="content-type" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="faq">FAQ</option>
              <option value="policy">Policy</option>
              <option value="page">Page</option>
              <option value="announcement">Announcement</option>
            </Select>
          </FormField>
          <FormField label="Body" htmlFor="content-body">
            <TextArea id="content-body" rows={5} value={body} onChange={(e) => setBody(e.target.value)} />
          </FormField>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={isPublished} onChange={(e) => setIsPublished(e.target.checked)} className="rounded border-gray-300" />
            Published
          </label>
        </form>
      </Modal>
    </div>
  );
}
