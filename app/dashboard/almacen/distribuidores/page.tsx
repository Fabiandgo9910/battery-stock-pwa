'use client';

import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import ConfirmModal from '@/components/ConfirmModal';
import Pagination from '@/components/Pagination';
import { usePagination } from '@/hooks/usePagination';
import type { Supplier } from '@/types/domain';

export default function DistribuidoresPage() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<Supplier | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [name, setName] = useState('');
  const [taxId, setTaxId] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');

  async function load() {
    const res = await fetch('/api/suppliers');
    const json = await res.json();
    setSuppliers(json.suppliers ?? []);
  }

  useEffect(() => {
    load();
  }, []);

  function resetForm() {
    setName('');
    setTaxId('');
    setPhone('');
    setEmail('');
    setShowForm(false);
    setEditingId(null);
  }

  function startEdit(s: Supplier) {
    setEditingId(s.id);
    setName(s.name);
    setTaxId(s.tax_id ?? '');
    setPhone(s.contact_phone ?? '');
    setEmail(s.contact_email ?? '');
    setShowForm(true);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    const payload = { name, tax_id: taxId, contact_phone: phone, contact_email: email };
    const res = editingId
      ? await fetch(`/api/suppliers/${editingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      : await fetch('/api/suppliers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
    const json = await res.json().catch(() => ({}));
    setSubmitting(false);
    if (!res.ok) {
      toast.error(json.error || 'Error al guardar el distribuidor.');
      return;
    }
    toast.success(editingId ? 'Distribuidor actualizado.' : 'Distribuidor añadido.');
    resetForm();
    load();
  }

  async function confirmDelete() {
    if (!toDelete) return;
    setSubmitting(true);
    const res = await fetch(`/api/suppliers/${toDelete.id}`, { method: 'DELETE' });
    const json = await res.json().catch(() => ({}));
    setSubmitting(false);
    setToDelete(null);
    if (!res.ok) {
      toast.error(json.error || 'Error al eliminar el distribuidor.');
      return;
    }
    toast.success(json.deactivatedInstead ? json.message : 'Distribuidor eliminado.');
    load();
  }

  const filtered = suppliers.filter((s) => s.name.toLowerCase().includes(search.toLowerCase()));
  const { page, setPage, pageItems, total } = usePagination(filtered, 10);

  return (
    <div className="mx-auto max-w-2xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Distribuidores</h1>
          <p className="mt-1 text-sm text-slate-500">Empresas que suministran mercancía al almacén.</p>
        </div>
        <button className="btn-charge" onClick={() => (showForm ? resetForm() : setShowForm(true))}>
          {showForm ? 'Cerrar' : '+ Nuevo'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={submit} className="card mt-6 space-y-4">
          <div>
            <label className="label-field">Nombre *</label>
            <input required className="input-field" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label-field">CIF/NIF</label>
              <input className="input-field" value={taxId} onChange={(e) => setTaxId(e.target.value)} />
            </div>
            <div>
              <label className="label-field">Teléfono</label>
              <input className="input-field" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="label-field">Email</label>
            <input type="email" className="input-field" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <button type="submit" disabled={submitting} className="btn-charge w-full">
            {submitting ? 'Guardando…' : editingId ? 'Guardar cambios' : 'Guardar distribuidor'}
          </button>
        </form>
      )}

      <input
        className="input-field mt-6"
        placeholder="Buscar distribuidor…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <div className="mt-4 space-y-3">
        {pageItems.map((s) => (
          <div key={s.id} className="card flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-semibold text-slate-900">{s.name}</p>
              <p className="text-sm text-slate-500">{s.contact_phone} {s.contact_email && `· ${s.contact_email}`}</p>
              {s.tax_id && <p className="text-xs text-slate-400">{s.tax_id}</p>}
            </div>
            <div className="flex gap-2">
              <button className="btn-secondary" onClick={() => startEdit(s)}>Editar</button>
              <button className="btn-secondary text-red-600" onClick={() => setToDelete(s)}>Eliminar</button>
            </div>
          </div>
        ))}
        {suppliers.length === 0 && <div className="card text-center text-slate-400">Sin distribuidores todavía.</div>}
        {suppliers.length > 0 && filtered.length === 0 && (
          <div className="card text-center text-slate-400">Ningún distribuidor coincide con la búsqueda.</div>
        )}
      </div>

      <Pagination page={page} pageSize={10} total={total} onPageChange={setPage} />

      <ConfirmModal
        open={!!toDelete}
        title="Eliminar distribuidor"
        description={`Vas a eliminar a ${toDelete?.name}. Si ya tiene recepciones registradas, se desactivará en su lugar para no perder el histórico.`}
        confirmLabel="Eliminar"
        tone="danger"
        loading={submitting}
        onConfirm={confirmDelete}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}
