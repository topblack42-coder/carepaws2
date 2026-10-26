import { useId, useRef, useState, type ReactNode } from "react";
import Modal from "../ui/Modal";
import Button from "../ui/Button";
import TextArea from "../ui/TextArea";

const MAX_NOTE = 2000;

interface ConfirmActionModalProps {
  title: string;
  /** What will happen when the admin confirms. */
  summary: ReactNode;
  noteLabel: string;
  noteHelp?: string;
  /** When set, the note is required and must have at least this many characters. */
  requiredMinLength?: number;
  confirmLabel: string;
  variant?: "primary" | "danger";
  /** Resolves to an error message, or null on success (the modal then closes). */
  onSubmit: (note: string) => Promise<string | null>;
  onClose: () => void;
}

/** Confirmation dialog with a note field, an inline error and a double-submit guard. */
export default function ConfirmActionModal({
  title,
  summary,
  noteLabel,
  noteHelp,
  requiredMinLength,
  confirmLabel,
  variant = "primary",
  onSubmit,
  onClose,
}: ConfirmActionModalProps) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);
  const fieldId = useId();
  const errorId = `${fieldId}-error`;
  const helpId = `${fieldId}-help`;
  const required = requiredMinLength !== undefined;

  async function submit() {
    if (submitting.current) return;
    const trimmed = note.trim();
    if (required && trimmed.length < requiredMinLength) {
      setError(`Enter a reason of at least ${requiredMinLength} characters.`);
      return;
    }
    submitting.current = true;
    setSaving(true);
    setError(null);
    const failure = await onSubmit(trimmed);
    submitting.current = false;
    if (failure === null) {
      onClose();
    } else {
      setSaving(false);
      setError(failure);
    }
  }

  return (
    <Modal
      isOpen
      title={title}
      onClose={saving ? () => {} : onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant={variant} onClick={submit} loading={saving}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="text-sm text-gray-700">{summary}</div>
        <div>
          <label htmlFor={fieldId} className="mb-1 block text-sm font-medium text-gray-800">
            {noteLabel}
            {required ? <span className="text-status-danger"> (required)</span> : <span className="font-normal text-gray-500"> (optional)</span>}
          </label>
          <TextArea
            id={fieldId}
            rows={4}
            value={note}
            maxLength={MAX_NOTE}
            disabled={saving}
            onChange={(e) => setNote(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={`${helpId}${error ? ` ${errorId}` : ""}`}
          />
          <p id={helpId} className="mt-1 flex justify-between gap-2 text-xs text-gray-600">
            <span>{noteHelp}</span>
            <span aria-hidden="true">
              {note.length}/{MAX_NOTE}
            </span>
          </p>
        </div>
        {error && (
          <p id={errorId} role="alert" className="rounded-lg border border-status-danger/20 bg-status-dangerBg px-3 py-2 text-sm text-status-danger">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
