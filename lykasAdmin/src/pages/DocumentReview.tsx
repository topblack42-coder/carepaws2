import { useState } from "react";
import { CheckCircle2, XCircle, FileText } from "lucide-react";
import { useResourceList } from "../hooks/useResourceList";
import { api, getApiErrorMessage } from "../services/api";
import { PageHeader } from "../components/ui/SharedUI";
import DataTable, { type Column } from "../components/ui/DataTable";
import StatusBadge from "../components/ui/StatusBadge";
import Modal from "../components/ui/Modal";
import Button from "../components/ui/Button";
import TextArea from "../components/ui/TextArea";
import { useToast } from "../context/ToastContext";
import IconButton from "../components/ui/IconButton";

interface UserDocument {
  _id: string;
  user: { displayName: string; email: string };
  application?: { _id: string; stage: string; status: string; pet?: { name: string } };
  type: string;
  fileUrl: string;
  status: string;
  rejectedReason?: string;
  createdAt: string;
}

export default function DocumentReview() {
  const list = useResourceList<UserDocument>("/api/documents");
  const { showToast } = useToast();
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<UserDocument | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  async function verify(doc: UserDocument, status: "verified" | "rejected", rejectedReason?: string) {
    setActingOn(doc._id);
    try {
      await api.put(`/api/documents/${doc._id}/verify`, status === "rejected" ? { status, rejectedReason } : { status });
      showToast(`Document ${status}`, "success");
      list.reload();
    } catch (err) {
      showToast(getApiErrorMessage(err, "Failed to update document"), "error");
    } finally {
      setActingOn(null);
    }
  }

  function openRejectModal(doc: UserDocument) {
    setRejectReason("");
    setRejecting(doc);
  }

  async function confirmReject() {
    if (!rejecting) return;
    await verify(rejecting, "rejected", rejectReason.trim() || undefined);
    setRejecting(null);
  }

  const columns: Column<UserDocument>[] = [
    { key: "user", header: "Applicant", accessor: (d) => d.user?.displayName },
    { key: "application", header: "Application", accessor: (d) => d.application ? `${d.application.pet?.name ?? "Pet"} · ${d.application.stage}` : "Unlinked" },
    { key: "type", header: "Document type", accessor: (d) => <span className="capitalize">{d.type.replace(/_/g, " ")}</span> },
    {
      key: "fileUrl",
      header: "File",
      accessor: (d) => (
        <a href={d.fileUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-primary hover:underline">
          <FileText className="h-3.5 w-3.5" aria-hidden="true" /> View
        </a>
      ),
    },
    {
      key: "status",
      header: "Status",
      accessor: (d) => (
        <div>
          <StatusBadge status={d.status} />
          {d.status === "rejected" && d.rejectedReason && <p className="mt-1 text-xs text-gray-500">{d.rejectedReason}</p>}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title="Document Review" description="Verify uploaded identity and adoption documents." />
      <DataTable
        columns={columns}
        rows={list.rows}
        rowKey={(d) => d._id}
        loading={list.loading}
        error={list.error}
        onRetry={list.reload}
        emptyTitle="No documents to review"
        searchValue={list.search}
        onSearchChange={list.onSearchChange}
        filters={[{ key: "status", label: "Status", options: [{ value: "pending", label: "Pending" }, { value: "verified", label: "Verified" }, { value: "rejected", label: "Rejected" }] }]}
        filterValues={list.filters}
        onFilterChange={list.onFilterChange}
        page={list.pagination.page}
        pages={list.pagination.pages}
        total={list.pagination.total}
        onPageChange={list.setPage}
        rowActions={(d) =>
          d.status === "pending" ? (
            <div className="flex justify-end gap-1">
              <IconButton label="Verify document" tone="success" disabled={actingOn === d._id} onClick={() => verify(d, "verified")}>
                <CheckCircle2 className="h-4 w-4" />
              </IconButton>
              <IconButton label="Reject document" tone="danger" disabled={actingOn === d._id} onClick={() => openRejectModal(d)}>
                <XCircle className="h-4 w-4" />
              </IconButton>
            </div>
          ) : null
        }
      />

      <Modal
        isOpen={rejecting !== null}
        onClose={() => setRejecting(null)}
        title="Reject document"
        footer={
          <>
            <Button variant="secondary" onClick={() => setRejecting(null)}>
              Cancel
            </Button>
            <Button variant="danger" loading={actingOn === rejecting?._id} onClick={confirmReject}>
              Reject document
            </Button>
          </>
        }
      >
        <p className="mb-3 text-sm text-gray-600">
          Let {rejecting?.user?.displayName ?? "the applicant"} know why this document couldn't be verified so they can re-upload it correctly.
        </p>
        <TextArea
          rows={3}
          placeholder="e.g. Photo is blurry, or the address doesn't match what's on file"
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
        />
      </Modal>
    </div>
  );
}
