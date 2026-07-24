'use client';

import { useEffect, useState } from 'react';
import { createBrowserClient } from '@/lib/supabaseClient';
import type { ProductModel } from '@/types/domain';

interface Row extends ProductModel {
  product_ean_codes: { ean_code: string }[];
  warehouse_stock?: { quantity: number }[];
}

export default function ProductosPage() {
  const supabase = createBrowserClient();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('product_models')
        .select('*, product_ean_codes(ean_code), warehouse_stock(quantity)')
        .eq('active', true)
        .order('brand');
      setRows((data as any) ?? []);
      setLoading(false);
    }
    load();
  }, [supabase]);

  const filtered = rows.filter((r) =>
    `${r.brand} ${r.model_name}`.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-semibold text-slate-900">Modelos de producto</h1>
      <p className="mt-1 text-sm text-slate-500">
        Catálogo de baterías dado de alta en el sistema (se crean automáticamente al escanear un EAN nuevo en Recepción).
      </p>

      <input
        className="input-field mt-6"
        placeholder="Buscar por marca o modelo…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Modelo</th>
              <th className="px-4 py-3">Ah / CCA</th>
              <th className="px-4 py-3">Tecnología</th>
              <th className="px-4 py-3">EAN</th>
              <th className="px-4 py-3">Stock almacén</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-400">Cargando…</td></tr>
            )}
            {filtered.map((r) => {
              const stock = r.warehouse_stock?.reduce((sum, s) => sum + s.quantity, 0) ?? 0;
              return (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-900">{r.brand} {r.model_name}</p>
                    {r.is_special && (
                      <p className="text-xs text-charge-700">Especial: {r.special_reason}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {r.amperage_ah ? `${r.amperage_ah} Ah` : '—'} / {r.cold_cranking_amps ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-600 uppercase">{r.battery_tech ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-500">
                    {r.product_ean_codes?.map((e) => e.ean_code).join(', ')}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                      stock <= r.min_stock_alert ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'
                    }`}>
                      {stock}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
