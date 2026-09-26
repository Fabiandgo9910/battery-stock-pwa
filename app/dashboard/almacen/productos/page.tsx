'use client';

import { useEffect, useState } from 'react';
import { createBrowserClient } from '@/lib/supabaseClient';
import ConfirmModal from '@/components/ConfirmModal';
import Pagination from '@/components/Pagination';
import ProductDetailsModal from '@/components/ProductDetailsModal';
import InventoryModal from '@/components/InventoryModal';
import { useServerPagination, type ServerPageResult } from '@/hooks/useServerPagination';
import toast from 'react-hot-toast';
import type { ProductModel } from '@/types/domain';

interface Row extends ProductModel {
  product_ean_codes: { ean_code: string }[];
  warehouse_stock?: { quantity: number; warehouse: { is_warranty_holding: boolean } | null }[];
}

interface ImportResult {
  created: number;
  updated: number;
  warnings: string[];
}

async function fetchProductsPage(
  { page, pageSize, search }: { page: number; pageSize: number; search: string },
  signal: AbortSignal
): Promise<ServerPageResult<Row>> {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (search) params.set('search', search);
  const res = await fetch(`/api/product-models?${params.toString()}`, { signal });
  const json = await res.json();
  return { items: json.product_models ?? [], total: json.total ?? 0 };
}

export default function ProductosPage() {
  const supabase = createBrowserClient();
  const { page, setPage, search, setSearch, items, total, loading, reload } = useServerPagination(fetchProductsPage, { pageSize: 15 });

  const [editing, setEditing] = useState<Row | null>(null);
  const [detailsRow, setDetailsRow] = useState<Row | null>(null);
  const [toDelete, setToDelete] = useState<Row | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [showInventory, setShowInventory] = useState(false);
  const [warehouseId, setWarehouseId] = useState('');

  const [brand, setBrand] = useState('');
  const [modelName, setModelName] = useState('');
  const [amperage, setAmperage] = useState('');
  const [cca, setCca] = useState('');
  const [tech, setTech] = useState<'normal' | 'agm' | 'efb'>('normal');
  const [isSpecial, setIsSpecial] = useState(false);
  const [specialReason, setSpecialReason] = useState('');
  const [minStock, setMinStock] = useState('5');

  useEffect(() => {
    async function loadRole() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const { data } = await supabase.from('profiles').select('role').eq('id', session.user.id).single();
      setIsAdmin(data?.role === 'admin');
    }
    async function loadWarehouse() {
      const { data: wh } = await supabase.from('warehouses').select('*').eq('active', true).eq('is_warranty_holding', false).limit(1).single();
      if (wh) setWarehouseId(wh.id);
    }
    loadRole();
    loadWarehouse();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImporting(true);
    setImportResult(null);
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch('/api/imports/almacen-productos', { method: 'POST', body: formData });
    const json = await res.json().catch(() => ({}));
    setImporting(false);
    if (!res.ok) {
      toast.error(json.error || 'Error al importar el Excel.');
      return;
    }
    setImportResult(json);
    toast.success(`Importado: ${json.created} creados, ${json.updated} actualizados.`);
    reload();
  }

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
    reload();
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
    reload();
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Modelos de producto</h1>
          <p className="mt-1 text-sm text-slate-500">
            Catálogo de baterías. Se crean automáticamente al escanear un EAN nuevo en Recepción, y aquí puedes editarlas o eliminarlas.
          </p>
        </div>
        <button className="btn-charge whitespace-nowrap" onClick={() => setShowInventory(true)}>
          📋 Hacer inventario
        </button>
      </div>

      <div className="card mt-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-900">Catálogo completo en Excel</p>
          <p className="text-xs text-slate-400">
            Todos los modelos, cantidades y propiedades (incluido el EAN), en el mismo formato para exportar e importar.
            El EAN es el identificador único: un modelo solo puede tener un EAN.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="btn-secondary whitespace-nowrap"
            onClick={() => window.open('/api/exports/almacen-productos', '_blank')}
          >
            Exportar catálogo
          </button>
          {isAdmin && (
            <label className="btn-charge cursor-pointer whitespace-nowrap">
              {importing ? 'Importando…' : 'Importar catálogo'}
              <input type="file" accept=".xlsx" className="hidden" disabled={importing} onChange={handleImportFile} />
            </label>
          )}
        </div>
      </div>

      {importResult && (
        <div className="card mt-3 border-2 border-charge-200 text-sm">
          <p className="font-medium text-slate-900">
            Importación completada: {importResult.created} modelo(s) nuevos, {importResult.updated} actualizados.
          </p>
          {importResult.warnings.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-amber-700">
              {importResult.warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          )}
          <button className="mt-3 text-xs text-slate-400 underline" onClick={() => setImportResult(null)}>Cerrar</button>
        </div>
      )}

      <input
        className="input-field mt-6"
        placeholder="Buscar por marca, modelo o referencia…"
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
            {items.length === 0 && !loading && (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-slate-400">Sin resultados.</td></tr>
            )}
            {!loading && items.map((r) => {
              const stock = r.warehouse_stock
                ?.filter((s) => !s.warehouse?.is_warranty_holding)
                .reduce((sum, s) => sum + s.quantity, 0) ?? 0;
              const warrantyStock = r.warehouse_stock
                ?.filter((s) => s.warehouse?.is_warranty_holding)
                .reduce((sum, s) => sum + s.quantity, 0) ?? 0;
              return (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="px-4 py-3">
                    <button className="text-left font-medium text-slate-900 hover:underline" onClick={() => setDetailsRow(r)}>
                      {r.brand} {r.model_name}
                    </button>
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
                    <div className="flex flex-wrap gap-2">
                      <button className="btn-secondary" onClick={() => setDetailsRow(r)}>Ver detalles</button>
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

      {detailsRow && <ProductDetailsModal model={detailsRow} onClose={() => setDetailsRow(null)} />}

      {showInventory && warehouseId && (
        <InventoryModal
          warehouseId={warehouseId}
          onClose={() => setShowInventory(false)}
          onCounted={reload}
        />
      )}

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
