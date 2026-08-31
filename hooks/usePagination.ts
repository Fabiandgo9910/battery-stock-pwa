'use client';

import { useEffect, useState } from 'react';

/**
 * Pagina cualquier array ya cargado/filtrado en el cliente. Vuelve a la
 * página 1 automáticamente cuando cambia el tamaño de la lista (p. ej. al
 * escribir en un buscador), para no quedarse en una página vacía.
 */
export function usePagination<T>(items: T[], pageSize = 10) {
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [items.length]);

  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageItems = items.slice((safePage - 1) * pageSize, safePage * pageSize);

  return { page: safePage, setPage, pageItems, totalPages, pageSize, total: items.length };
}
