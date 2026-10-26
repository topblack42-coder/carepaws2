import { EmptyState } from "../ui/StateDisplays";
import { formatDateTime, formatRelative, getEntryReason, stageLabel, type StageHistoryEntry } from "./applicationUtils";

/** Newest-first vertical timeline of stage changes. */
export default function StageTimeline({ history }: { history: StageHistoryEntry[] }) {
  if (!history.length) return <EmptyState title="No stage history" />;

  return (
    <ol className="relative ml-2 border-l-2 border-gray-200">
      {history
        .slice()
        .reverse()
        .map((entry, index) => {
          const reason = getEntryReason(entry);
          const decision = entry.stage === "approved" || entry.stage === "rejected";
          return (
            <li key={`${entry.changedAt}-${index}`} className="relative pb-5 pl-5 last:pb-0">
              <span
                aria-hidden="true"
                className={`absolute -left-[7px] top-1.5 h-3 w-3 rounded-full border-2 border-white ${
                  entry.stage === "rejected" ? "bg-status-danger" : index === 0 ? "bg-primary" : "bg-gray-400"
                }`}
              />
              <p className="text-sm font-semibold text-gray-900">{stageLabel(entry.stage)}</p>
              <p className="text-sm text-gray-700">by {entry.changedBy?.displayName ?? "System"}</p>
              <p className="text-xs text-gray-600">
                <time dateTime={entry.changedAt} title={formatRelative(entry.changedAt)}>
                  {formatDateTime(entry.changedAt)}
                </time>
                {" · "}
                {formatRelative(entry.changedAt)}
              </p>
              {reason && (
                <p className={`mt-1 rounded-md px-2 py-1 text-sm ${decision ? "bg-gray-100 text-gray-900" : "text-gray-700"}`}>
                  {decision && <span className="font-medium">{entry.stage === "rejected" ? "Reason: " : "Note: "}</span>}
                  {reason}
                </p>
              )}
            </li>
          );
        })}
    </ol>
  );
}
