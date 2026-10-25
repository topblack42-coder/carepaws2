import { useCallback, useEffect, useRef, useState } from "react";
import { api, getApiErrorMessage } from "../services/api";
import { useRealtime } from "../context/RealtimeContext";
import { resourcesForEndpoint } from "../services/realtimeResources";

interface Pagination {
  total: number;
  page: number;
  limit: number;
  pages: number;
}

/**
 * Generic list-fetching hook backing the DataTable pattern (§7.3, §8.2).
 * Wires search/filter/pagination state directly onto the backend's shared
 * buildListQuery/buildPagination contract — the same q/filterFields/page/
 * limit params every list endpoint understands.
 */
export function useResourceList<T>(
  endpoint: string,
  extraParams: Record<string, string> = {},
  options: { resources?: readonly string[] } = {}
) {
  const [rows, setRows] = useState<T[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ total: 0, page: 1, limit: 20, pages: 1 });
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => setReloadToken((t) => t + 1), []);

  // Live updates: refetch in the background when the server reports a change
  // to anything this list shows. "Silent" = keep current rows on screen, no
  // spinner, and don't replace them with an error if the refetch fails.
  const silentRef = useRef(false);
  const refreshSilently = useCallback(() => {
    silentRef.current = true;
    setReloadToken((t) => t + 1);
  }, []);
  useRealtime(options.resources ?? resourcesForEndpoint(endpoint), refreshSilently);

  useEffect(() => {
    let cancelled = false;
    const silent = silentRef.current;
    silentRef.current = false;
    if (!silent) {
      setLoading(true);
      setError(null);
    }

    const params: Record<string, string> = { page: String(page), limit: "20", ...extraParams };
    if (search) params.q = search;
    for (const [key, value] of Object.entries(filters)) {
      if (value && value !== "All") params[key] = value;
    }

    api
      .get(endpoint, { params })
      .then((res) => {
        if (cancelled) return;
        const data = res.data.data ?? [];
        setRows(data);
        if (res.data.pagination) {
          setPagination(res.data.pagination);
        } else {
          setPagination({ total: data.length, page: 1, limit: data.length || 20, pages: 1 });
        }
      })
      .catch((err) => {
        if (!cancelled && !silent) setError(getApiErrorMessage(err, "Failed to load data"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint, page, search, JSON.stringify(filters), reloadToken]);

  const onFilterChange = useCallback((key: string, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  }, []);

  const onSearchChange = useCallback((value: string) => {
    setSearch(value);
    setPage(1);
  }, []);

  return { rows, pagination, page, setPage, search, onSearchChange, filters, onFilterChange, loading, error, reload };
}
