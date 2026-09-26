'use client';

import { useEffect, useRef, useState } from 'react';
import type { ProductModel } from '@/types/domain';

interface ModelPickerProps {
  onSelect: (model: ProductModel) => void;
  label?: string;
}

/**
 * Buscador de modelos de producto por referencia (marca/modelo/EAN/GPN), sin
 * cámara ni escáner. Busca en el servidor a medida que escribes (con
 * debounce), en vez de descargar todo el catálogo de golpe — importante
 * porque este componente se usa en muchas pantallas distintas.
 */
export default function ModelPicker({ onSelect, label = 'Buscar por referencia (marca / modelo)' }: ModelPickerProps) {
  const [results, setResults] = useState<ProductModel[]>([]);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!search.trim()) {
      setResults([]);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      fetch(`/api/product-models?search=${encodeURIComponent(search.trim())}&pageSize=8`, { signal: controller.signal })
        .then((r) => r.json())
        .then((json) => {
          if (!controller.signal.aborted) setResults(json.product_models ?? []);
        })
        .catch((err) => {
          if (err?.name !== 'AbortError') console.error(err);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [search]);

  return (
    <div className="relative">
      <label className="label-field">{label}</label>
      <input
        className="input-field"
        placeholder="Escribe para buscar…"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
      />
      {open && search.trim() && (loading || results.length > 0) && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">
            {loading && <p className="px-3 py-2.5 text-sm text-slate-400">Buscando…</p>}
            {!loading && results.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  onSelect(m);
                  setSearch('');
                  setOpen(false);
                }}
                className="block w-full border-b border-slate-50 px-3 py-2.5 text-left text-sm last:border-0 hover:bg-slate-50"
              >
                <span className="font-medium text-slate-900">{m.brand} {m.model_name}</span>
                {m.amperage_ah && <span className="text-slate-400"> · {m.amperage_ah} Ah</span>}
              </button>
            ))}
          </div>
        </>
      )}
      {open && search.trim() && !loading && results.length === 0 && (
        <p className="mt-1 text-xs text-slate-400">Sin resultados. Da de alta el modelo desde Recepción primero.</p>
      )}
    </div>
  );
}
