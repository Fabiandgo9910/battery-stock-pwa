'use client';

import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import type { Supplier } from '@/types/domain';

export default function DistribuidoresPage() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [taxId, setTaxId] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    const res = await fetch('/api/suppliers');
    const json = await res.json();
    setSuppliers(json.suppliers ?? []);
  }

  useEffect(() => {
    load();
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    const res = await fetch('/api/suppliers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, tax_id: taxId, contact_phone: phone, contact_email: email }),
    });
    setSubmitting(false);
    if (!res.ok) {
      toast.error('Error al crear el distribuidor.');
      return;
    }
    toast.success('Distribuidor añadido.');
    setName(''); setTaxId(''); setPhone(''); setEmail(''); setShowForm(false);
    load();
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Distribuidores</h1>
          <p className="mt-1 text-sm text-slate-500">Empresas que suministran mercancía al almacén.</p>
        </div>
        <button className="btn-charge" onClick={() => setShowForm(!showForm)}>
          {showForm ? 'Cerrar' : '+ Nuevo'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={create} className="card mt-6 space-y-4">
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
            {submitting ? 'Guardando…' : 'Guardar distribuidor'}
          </button>
        </form>
      )}

      <div className="mt-6 space-y-3">
        {suppliers.map((s) => (
          <div key={s.id} className="card">
            <p className="font-semibold text-slate-900">{s.name}</p>
            <p className="text-sm text-slate-500">{s.contact_phone} {s.contact_email && `· ${s.contact_email}`}</p>
          </div>
        ))}
        {suppliers.length === 0 && <div className="card text-center text-slate-400">Sin distribuidores todavía.</div>}
      </div>
    </div>
  );
}
