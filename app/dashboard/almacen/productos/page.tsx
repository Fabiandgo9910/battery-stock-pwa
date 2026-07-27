'use client';

import { useEffect, useState } from 'react';
import { createBrowserClient } from '@/lib/supabaseClient';
import ConfirmModal from '@/components/ConfirmModal';
import Pagination from '@/components/Pagination';
import { usePagination } from '@/hooks/usePagination';
import toast from 'react-hot-toast';
import type { ProductModel } from '@/types/domain';

interface Row extends ProductModel {
  product_ean_codes: { ean_code: string }[];
  warehouse_stock?: { quantity: number; warehouse: { is_warranty_holding: boolean } | null }[];
}

export default function ProductosPage() {
  const supabase = createBrowserClient();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Row | null>(null);
  const [toDelete, setToDelete] = useState<Row | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [brand, setBrand] = useState('');
  const [modelName, setModelName] = useState('');
  const [amperage, setAmperage] = useState('');
  const [cca, setCca] = useState('');
  const [tech, setTech] = useState<'normal' | 'agm' | 'efb'>('normal');
  const [isSpecial, setIsSpecial] = useState(false);
  const [specialReason, setSpecialReason] = useState('');
  const [minStock, setMinStock] = useState('5');

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from('product_models')
      .select('*, product_ean_codes(ean_code), warehouse_stock(quantity, warehouse:warehouses(is_warranty_holding))')
      .eq('active', true)
      .order('brand');
    setRows((data as any) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function startEdit(r: Row) {
    setEditing(r);
    setBrand(r.brand);
    setModelName(r.model_name);
    setAmperage(r.amperage_ah?.toString() ?? '');
    setCca(r.cold_cranking_amps?.toString() ?? '');
    setTech(r.battery_tech ?? 'normal');
    setIsSpecial(r.is_special);
    setSpecialReason(r.special_reason ?? '');
    setMinStock(r.min_stock_alert?.toString() ?? '5');
  }

  async function saveEdit() {
    if (!editing) return;
    setSubmitting(true);
    const res = await fetch(`/api/product-models/${editing.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        brand,
        model_name: modelName,
        amperage_ah: amperage ? Number(amperage) : null,
        cold_cranking_amps: cca ? Number(cca) : null,
        battery_tech: tech,
        is_special: isSpecial,
        special_reason: isSpecial ? specialReason : null,
        min_stock_alert: Number(minStock) || 5,
      }),
    });
    const json = await res.json().catch(() => ({}));
    setSubmitting(false);
    if (!res.ok) {
      toast.error(json.error || 'Error al guardar los cambios.');
      return;
    }
    toast.success('Modelo actualizado.');
    setEditing(null);
    load();
  }

  async function confirmDelete() {
    if (!toDelete) return;
    setSubmitting(true);
    const res = await fetch(`/api/product-models/${toDelete.id}`, { method: 'DELETE' });
    const json = await res.json().catch(() => ({}));
    setSubmitting(false);
    setToDelete(null);
    if (!res.ok) {
      toast.error(json.error || 'Error al eliminar el modelo.');
      return;
    }
    toast.success(json.deactivatedInstead ? json.message : 'Modelo eliminado.');
    load();
  }

  const filtered = rows.filter((r) =>
    `${r.brand} ${r.model_name}`.toLowerCase().includes(search.toLowerCase())
  );
  const { page, setPage, pageItems, total } = usePagination(filtered, 15);

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-semibold text-slate-900">Modelos de producto</h1>
      <p className="mt-1 text-sm text-slate-500">
        Catálogo de baterías. Se crean automáticamente al escanear un EAN nuevo en Recepción, y aquí puedes editarlas o eliminarlas.
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
              <th className="px-4 py-3">Stock garantías</th>
              <th className="px-4 py-3">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-slate-400">Cargando…</td></tr>
            )}
            {filtered.length === 0 && !loading && (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-slate-400">Sin resultados.</td></tr>
            )}
            {pageItems.map((r) => {
              const stock = r.warehouse_stock
                ?.filter((s) => !s.warehouse?.is_warranty_holding)
                .reduce((sum, s) => sum + s.quantity, 0) ?? 0;
              const warrantyStock = r.warehouse_stock
                ?.filter((s) => s.warehouse?.is_warranty_holding)
                .reduce((sum, s) => sum + s.quantity, 0) ?? 0;
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
                  <td className="px-4 py-3">
                    {warrantyStock > 0 ? (
                      <span className="rounded-full bg-charge-100 px-2.5 py-1 text-xs font-semibold text-charge-700">
                        {warrantyStock}
                      </span>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <button className="btn-secondary" onClick={() => startEdit(r)}>Editar</button>
                      <button className="btn-secondary text-red-600" onClick={() => setToDelete(r)}>Eliminar</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Pagination page={page} pageSize={15} total={total} onPageChange={setPage} />

      {editing && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full sm:max-w-md max-h-[85vh] overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-slate-900">Editar modelo</h2>
            <div className="mt-4 space-y-4">
              <div>
                <label className="label-field">Marca *</label>
                <input className="input-field" value={brand} onChange={(e) => setBrand(e.target.value)} />
              </div>
              <div>
                <label className="label-field">Modelo *</label>
                <input className="input-field" value={modelName} onChange={(e) => setModelName(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label-field">Amperaje (Ah)</label>
                  <input type="number" className="input-field" value={amperage} onChange={(e) => setAmperage(e.target.value)} />
                </div>
                <div>
                  <label className="label-field">Arranque en frío (CCA)</label>
                  <input type="number" className="input-field" value={cca} onChange={(e) => setCca(e.target.value)} />
                </div>
              </div>
              <div>
                <label className="label-field">Tecnología</label>
                <select className="input-field" value={tech} onChange={(e) => setTech(e.target.value as any)}>
                  <option value="normal">Normal</option>
                  <option value="agm">AGM</option>
                  <option value="efb">EFB</option>
                </select>
              </div>
              <div>
                <label className="label-field">Aviso de stock mínimo</label>
                <input type="number" className="input-field" value={minStock} onChange={(e) => setMinStock(e.target.value)} />
              </div>
              <div className="flex items-center gap-2">
                <input
                  id="edit-special"
                  type="checkbox"
                  checked={isSpecial}
                  onChange={(e) => setIsSpecial(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300"
                />
                <label htmlFor="edit-special" className="text-sm text-slate-700">Es una batería especial</label>
              </div>
              {isSpecial && (
                <div>
                  <label className="label-field">Motivo</label>
                  <input className="input-field" value={specialReason} onChange={(e) => setSpecialReason(e.target.value)} />
                </div>
              )}
            </div>
            <div className="mt-6 flex gap-3">
              <button className="btn-secondary flex-1" onClick={() => setEditing(null)}>Cancelar</button>
              <button className="btn-charge flex-1" disabled={submitting} onClick={saveEdit}>
                {submitting ? 'Guardando…' : 'Guardar cambios'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        open={!!toDelete}
        title="Eliminar modelo"
        description={`Vas a eliminar ${toDelete?.brand} ${toDelete?.model_name}. Si ya tiene movimientos de stock o ventas, se desactivará en su lugar para conservar el histórico.`}
        confirmLabel="Eliminar"
        tone="danger"
        loading={submitting}
        onConfirm={confirmDelete}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}
