'use client';

import { useEffect, useState } from 'react';
import type { ProductModel } from '@/types/domain';

interface ModelPickerProps {
  onSelect: (model: ProductModel) => void;
  label?: string;
}

/**
 * Buscador sencillo de modelos de producto por referencia (marca/modelo),
 * sin cámara ni escáner — para crear o editar pedidos, donde no hace falta
 * tener la batería físicamente delante, solo elegir qué y cuánto.
 * Lista todos los modelos que alguna vez se han dado de alta en el catálogo.
 */
export default function ModelPicker({ onSelect, label = 'Buscar por referencia (marca / modelo)' }: ModelPickerProps) {
  const [models, setModels] = useState<ProductModel[]>([]);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetch('/api/product-models')
      .then((r) => r.json())
      .then((json) => setModels(json.product_models ?? []))
      .catch(() => {});
  }, []);

  const filtered = search.trim()
    ? models
        .filter((m) => `${m.brand} ${m.model_name}`.toLowerCase().includes(search.toLowerCase()))
        .slice(0, 8)
    : [];

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
      {open && filtered.length > 0 && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">
            {filtered.map((m) => (
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
      {open && search.trim() && filtered.length === 0 && (
        <p className="mt-1 text-xs text-slate-400">Sin resultados. Da de alta el modelo desde Recepción primero.</p>
      )}
    </div>
  );
}
