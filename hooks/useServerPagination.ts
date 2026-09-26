'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface ServerPageResult<T> {
  items: T[];
  total: number;
}

/**
 * Pagina de verdad en el servidor: cada cambio de página o de búsqueda pide
 * SOLO esa página a la API (con `?page=&pageSize=&search=`), en vez de traer
 * toda la tabla y cortarla en el navegador. Cancela peticiones que se hayan
 * quedado obsoletas (p. ej. al escribir rápido en el buscador) para no pisar
 * una respuesta más nueva con una más vieja que llega tarde.
 */
export function useServerPagination<T>(
  fetchPage: (params: { page: number; pageSize: number; search: string }, signal: AbortSignal) => Promise<ServerPageResult<T>>,
  options?: { pageSize?: number; searchDebounceMs?: number }
) {
  const pageSize = options?.pageSize ?? 15;
  const debounceMs = options?.searchDebounceMs ?? 300;

  const [page, setPage] = useState(1);
  const [search, setSearchState] = useState('');
  const [items, setItems] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchPageRef = useRef(fetchPage);
  fetchPageRef.current = fetchPage;

  const load = useCallback(
    async (p: number, s: string) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      try {
        const result = await fetchPageRef.current({ page: p, pageSize, search: s }, controller.signal);
        if (controller.signal.aborted) return;
        setItems(result.items);
        setTotal(result.total);
      } catch (err: any) {
        if (err?.name !== 'AbortError') {
          console.error('useServerPagination load error', err);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    },
    [pageSize]
  );

  // Cambios de página: petición inmediata.
  useEffect(() => {
    load(page, search);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  function setSearch(value: string) {
    setSearchState(value);
    setPage(1);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => load(1, value), debounceMs);
  }

  function reload() {
    load(page, search);
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return { page, setPage, search, setSearch, items, total, totalPages, pageSize, loading, reload };
}
