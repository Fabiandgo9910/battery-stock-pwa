'use client';

import { useEffect, useState } from 'react';
import ConfirmModal from '@/components/ConfirmModal';
import toast from 'react-hot-toast';

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
  const [rows, setRows] = useState<PosRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [toDeactivate, setToDeactivate] = useState<PosRow | null>(null);

  const [name, setName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [taxId, setTaxId] = useState('');

  async function load() {
    setLoading(true);
    const res = await fetch('/api/points-of-sale');
    const json = await res.json();
    setRows(json.points_of_sale ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  function resetForm() {
    setName('');
    setOwnerName('');
    setPhone('');
    setAddress('');
    setTaxId('');
    setShowForm(false);
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    const res = await fetch('/api/points-of-sale', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, owner_name: ownerName, phone, address, tax_id: taxId }),
    });
    setSubmitting(false);
    if (!res.ok) {
      toast.error('Error al crear el punto de venta.');
      return;
    }
    toast.success('Punto de venta creado.');
    resetForm();
    load();
  }

  async function confirmDeactivate() {
    if (!toDeactivate) return;
    await fetch(`/api/points-of-sale/${toDeactivate.id}`, { method: 'DELETE' });
    toast.success('Punto de venta desactivado.');
    setToDeactivate(null);
    load();
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Puntos de venta</h1>
          <p className="mt-1 text-sm text-slate-500">Clientes/chiringuitos con su stock actual por modelo.</p>
        </div>
        <button className="btn-charge" onClick={() => setShowForm(!showForm)}>
          {showForm ? 'Cerrar' : '+ Nuevo'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={create} className="card mt-6 space-y-4">
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
            {submitting ? 'Guardando…' : 'Crear punto de venta'}
          </button>
        </form>
      )}

      <div className="mt-6 space-y-3">
        {loading && <p className="text-sm text-slate-400">Cargando…</p>}
        {rows.map((r) => (
          <div key={r.id} className="card">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-slate-900">
                  {r.name} {!r.active && <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-600">Inactivo</span>}
                </p>
                <p className="text-sm text-slate-500">{r.owner_name} {r.phone && `· ${r.phone}`}</p>
                {r.address && <p className="text-xs text-slate-400">{r.address}</p>}
              </div>
              {r.active && (
                <button className="btn-secondary text-red-600" onClick={() => setToDeactivate(r)}>
                  Desactivar
                </button>
              )}
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
      </div>

      <ConfirmModal
        open={!!toDeactivate}
        title="Desactivar punto de venta"
        description={`${toDeactivate?.name} dejará de estar disponible en los listados activos.`}
        confirmLabel="Desactivar"
        tone="danger"
        onConfirm={confirmDeactivate}
        onCancel={() => setToDeactivate(null)}
      />
    </div>
  );
}
