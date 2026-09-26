'use client';

import { useState } from 'react';
import toast from 'react-hot-toast';

interface PosOption {
  id: string;
  name: string;
}

interface ScrapDeliveryModalProps {
  pointsOfSale: PosOption[];
  onClose: () => void;
  onDone: () => void;
}

/** Registro de entrega de baterías viejas (chatarra) por parte de una empresa/taller. */
export default function ScrapDeliveryModal({ pointsOfSale, onClose, onDone }: ScrapDeliveryModalProps) {
  const [posId, setPosId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [weight, setWeight] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    const qty = Number(quantity);
    if (!posId) {
      toast.error('Selecciona la empresa o taller.');
      return;
    }
    if (!qty || qty <= 0) {
      toast.error('Indica cuántas baterías deja.');
      return;
    }
    setSubmitting(true);
    const res = await fetch('/api/scrap-deliveries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        point_of_sale_id: posId,
        quantity: qty,
        weight_kg: weight ? Number(weight) : undefined,
        notes: notes || undefined,
      }),
    });
    const json = await res.json().catch(() => ({}));
    setSubmitting(false);
    if (!res.ok) {
      toast.error(json.error || 'Error al registrar la entrega de chatarra.');
      return;
    }
    toast.success('Entrega de baterías viejas registrada.');
    onDone();
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/60 p-4">
      <div className="w-full sm:max-w-sm rounded-2xl bg-white p-6 shadow-xl max-h-[85vh] overflow-y-auto">
        <h2 className="text-lg font-semibold text-slate-900">Entrega de baterías viejas (chatarra)</h2>
        <p className="mt-1 text-sm text-slate-500">
          Registra cuántas baterías viejas deja una empresa/taller, y su peso si lo tienes a mano.
        </p>

        <div className="mt-4">
          <label className="label-field">Empresa o taller *</label>
          <select className="input-field" value={posId} onChange={(e) => setPosId(e.target.value)}>
            <option value="">Selecciona…</option>
            {pointsOfSale.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div>
            <label className="label-field">Cuántas deja *</label>
            <input
              type="number"
              min={1}
              className="input-field"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="Ej: 5"
            />
          </div>
          <div>
            <label className="label-field">Peso en kg (opcional)</label>
            <input
              type="number"
              min={0}
              step="0.1"
              className="input-field"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              placeholder="Ej: 62.5"
            />
          </div>
        </div>

        <div className="mt-4">
          <label className="label-field">Observación (opcional)</label>
          <textarea className="input-field" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        <div className="mt-6 flex gap-3">
          <button className="btn-secondary flex-1" onClick={onClose}>Cancelar</button>
          <button className="btn-charge flex-1" disabled={submitting} onClick={submit}>
            {submitting ? 'Guardando…' : 'Registrar'}
          </button>
        </div>
      </div>
    </div>
  );
}
