import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { LoadingState, EmptyState, ErrorState } from "./StateDisplays";
import { Input, Select } from "./FormUI";
import IconButton from "./IconButton";

export interface Column<T> {
  header: string;
  accessor: (row: T) => ReactNode;
  key: string;
}

export interface FilterOption {
  key: string;
  label: string;
  options: { value: string; label: string }[];
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  emptyTitle: string;
  emptyDescription?: string;

  searchValue: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;

  filters?: FilterOption[];
  filterValues?: Record<string, string>;
  onFilterChange?: (key: string, value: string) => void;

  page: number;
  pages: number;
  total: number;
  onPageChange: (page: number) => void;

  rowActions?: (row: T) => ReactNode;
}

export default function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading,
  error,
  onRetry,
  emptyTitle,
  emptyDescription,
  searchValue,
  onSearchChange,
  searchPlaceholder = "Search…",
  filters,
  filterValues,
  onFilterChange,
  page,
  pages,
  total,
  onPageChange,
  rowActions,
}: DataTableProps<T>) {
  return (
    <div className="animate-in rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-3 border-b border-gray-100 p-4">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden="true" />
          <Input
            value={searchValue}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            className="pl-9"
            aria-label="Search"
          />
        </div>
        {filters?.map((filter) => (
          <Select
            key={filter.key}
            value={filterValues?.[filter.key] ?? "All"}
            onChange={(e) => onFilterChange?.(filter.key, e.target.value)}
            aria-label={filter.label}
            className="w-auto"
          >
            <option value="All">{filter.label}: All</option>
            {filter.options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Select>
        ))}
      </div>

      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} onRetry={onRetry} />
      ) : rows.length === 0 ? (
        <EmptyState title={emptyTitle} description={emptyDescription} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-xs uppercase tracking-wide text-gray-400">
                {columns.map((col) => (
                  <th key={col.key} scope="col" className="px-4 py-3 font-medium">
                    {col.header}
                  </th>
                ))}
                {rowActions && (
                  <th scope="col" className="px-4 py-3 text-right font-medium">
                    Actions
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={rowKey(row)} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/60">
                  {columns.map((col) => (
                    <td key={col.key} className="px-4 py-3 text-gray-700">
                      {col.accessor(row)}
                    </td>
                  ))}
                  {rowActions && <td className="px-4 py-3 text-right">{rowActions(row)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && !error && rows.length > 0 && (
        <div className="flex items-center justify-between border-t border-gray-100 px-4 py-3 text-sm text-gray-500">
          <span>
            Page {page} of {pages} · {total} total
          </span>
          <div className="flex gap-1">
            <IconButton label="Previous page" onClick={() => onPageChange(page - 1)} disabled={page <= 1}>
              <ChevronLeft className="h-4 w-4" />
            </IconButton>
            <IconButton label="Next page" onClick={() => onPageChange(page + 1)} disabled={page >= pages}>
              <ChevronRight className="h-4 w-4" />
            </IconButton>
          </div>
        </div>
      )}
    </div>
  );
}
