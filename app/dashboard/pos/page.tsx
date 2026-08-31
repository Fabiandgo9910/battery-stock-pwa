'use client';

import { useEffect, useState } from 'react';
import ConfirmModal from '@/components/ConfirmModal';
import Pagination from '@/components/Pagination';
import { usePagination } from '@/hooks/usePagination';
import DirectDeliveryModal from '@/components/DirectDeliveryModal';
import toast from 'react-hot-toast';
import { createBrowserClient } from '@/lib/supabaseClient';

interface PosStockItem {
  quantity: number;
  product_model: { brand: string; model_name: string } | null;
}
interface PosRow {
  id: string;
  name: string;
  owner_name: string | null;
  phone: string | null;
  address: string | null;
  active: boolean;
  pos_stock: PosStockItem[];
}

export default function PosPage() {
  const supabase = createBrowserClient();
  const [rows, setRows] = useState<PosRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [toDelete, setToDelete] = useState<PosRow | null>(null);

  const [name, setName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [taxId, setTaxId] = useState('');
  const [search, setSearch] = useState('');

  const [deliveryTarget, setDeliveryTarget] = useState<PosRow | null>(null);
  const [warehouseId, setWarehouseId] = useState('');

  async function load() {
    setLoading(true);
    const res = await fetch('/api/points-of-sale');
    const json = await res.json();
    setRows(json.points_of_sale ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
    async function loadWarehouse() {
      const { data: wh } = await supabase.from('warehouses').select('*').eq('active', true).eq('is_warranty_holding', false).limit(1).single();
      if (wh) setWarehouseId(wh.id);
    }
    loadWarehouse();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function resetForm() {
    setName('');
    setOwnerName('');
    setPhone('');
    setAddress('');
    setTaxId('');
    setShowForm(false);
    setEditingId(null);
  }

  function startEdit(r: PosRow) {
    setEditingId(r.id);
    setName(r.name);
    setOwnerName(r.owner_name ?? '');
    setPhone(r.phone ?? '');
    setAddress(r.address ?? '');
    setShowForm(true);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    const payload = { name, owner_name: ownerName, phone, address, tax_id: taxId };
    const res = editingId
      ? await fetch(`/api/points-of-sale/${editingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      : await fetch('/api/points-of-sale', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
    const json = await res.json().catch(() => ({}));
    setSubmitting(false);
    if (!res.ok) {
      toast.error(json.error || 'Error al guardar la empresa.');
      return;
    }
    toast.success(editingId ? 'Empresa actualizada.' : 'Empresa creada.');
    resetForm();
    load();
  }

  async function confirmDelete() {
    if (!toDelete) return;
    setSubmitting(true);
    const res = await fetch(`/api/points-of-sale/${toDelete.id}`, { method: 'DELETE' });
    const json = await res.json().catch(() => ({}));
    setSubmitting(false);
    setToDelete(null);
    if (!res.ok) {
      toast.error(json.error || 'Error al eliminar la empresa.');
      return;
    }
    toast.success(json.deactivatedInstead ? json.message : 'Empresa eliminada.');
    load();
  }

  const filtered = rows.filter((r) => r.name.toLowerCase().includes(search.toLowerCase()));
  const { page, setPage, pageItems, total } = usePagination(filtered, 10);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Empresas</h1>
          <p className="mt-1 text-sm text-slate-500">
            Empresas y talleres a los que se les puede pedir o entregar directamente desde almacén.
          </p>
        </div>
        <button className="btn-charge" onClick={() => (showForm ? resetForm() : setShowForm(true))}>
          {showForm ? 'Cerrar' : '+ Nueva'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={submit} className="card mt-6 space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="label-field">Nombre *</label>
              <input required className="input-field" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label className="label-field">Persona de contacto</label>
              <input className="input-field" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} />
            </div>
            <div>
              <label className="label-field">Teléfono</label>
              <input className="input-field" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div>
              <label className="label-field">CIF/NIF</label>
              <input className="input-field" value={taxId} onChange={(e) => setTaxId(e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <label className="label-field">Dirección</label>
              <input className="input-field" value={address} onChange={(e) => setAddress(e.target.value)} />
            </div>
          </div>
          <button type="submit" disabled={submitting} className="btn-charge w-full">
            {submitting ? 'Guardando…' : editingId ? 'Guardar cambios' : 'Crear empresa'}
          </button>
        </form>
      )}

      <input
        className="input-field mt-6"
        placeholder="Buscar…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <div className="mt-4 space-y-3">
        {loading && <p className="text-sm text-slate-400">Cargando…</p>}
        {pageItems.map((r) => (
          <div key={r.id} className="card">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-slate-900">
                  {r.name} {!r.active && <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-600">Inactivo</span>}
                </p>
                <p className="text-sm text-slate-500">{r.owner_name} {r.phone && `· ${r.phone}`}</p>
                {r.address && <p className="text-xs text-slate-400">{r.address}</p>}
              </div>
              <div className="flex flex-wrap gap-2">
                <button className="btn-charge" onClick={() => setDeliveryTarget(r)}>Entrega directa</button>
                <button className="btn-secondary" onClick={() => startEdit(r)}>Editar</button>
                <button className="btn-secondary text-red-600" onClick={() => setToDelete(r)}>Eliminar</button>
              </div>
            </div>
            {r.pos_stock?.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {r.pos_stock.filter(s => s.quantity > 0).map((s, i) => (
                  <span key={i} className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs text-slate-700">
                    {s.product_model?.brand} {s.product_model?.model_name}: <strong>{s.quantity}</strong>
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
        {!loading && rows.length === 0 && (
          <div className="card text-center text-slate-400">Todavía no hay empresas dadas de alta.</div>
        )}
        {!loading && rows.length > 0 && filtered.length === 0 && (
          <div className="card text-center text-slate-400">Ninguna coincide con la búsqueda.</div>
        )}
      </div>

      <Pagination page={page} pageSize={10} total={total} onPageChange={setPage} />

      {deliveryTarget && (
        <DirectDeliveryModal
          pointsOfSale={rows}
          fixedPointOfSale={{ id: deliveryTarget.id, name: deliveryTarget.name }}
          warehouseId={warehouseId}
          onClose={() => setDeliveryTarget(null)}
          onDone={() => {
            setDeliveryTarget(null);
            load();
          }}
        />
      )}

      <ConfirmModal
        open={!!toDelete}
        title="Eliminar empresa"
        description={`Vas a eliminar ${toDelete?.name}. Si tiene pedidos o salidas asociadas, se desactivará en su lugar para no perder el histórico.`}
        confirmLabel="Eliminar"
        tone="danger"
        loading={submitting}
        onConfirm={confirmDelete}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}

