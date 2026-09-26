'use client';

import { useState } from 'react';
import ModelPicker from '@/components/ModelPicker';
import QuantityInput from '@/components/QuantityInput';
import ConfirmModal from '@/components/ConfirmModal';
import toast from 'react-hot-toast';
import type { ProductModel } from '@/types/domain';

interface CartItem {
  product_model: ProductModel;
  quantity: number;
}

export default function SolicitarPedidoPage() {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [notes, setNotes] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  function handleSelect(model: ProductModel) {
    if (cart.some((i) => i.product_model.id === model.id)) {
      toast('Ese modelo ya está en la solicitud, ajusta su cantidad abajo.');
      return;
    }
    setCart((prev) => [...prev, { product_model: model, quantity: 0 }]);
  }

  function updateQty(id: string, qty: number) {
    setCart((prev) => prev.map((i) => (i.product_model.id === id ? { ...i, quantity: qty } : i)));
  }
  function removeItem(id: string) {
    setCart((prev) => prev.filter((i) => i.product_model.id !== id));
  }
  function reset() {
    setCart([]);
    setNotes('');
  }

  async function submit() {
    const items = cart.filter((i) => i.quantity > 0);
    if (items.length === 0) {
      toast.error('Añade al menos una batería con cantidad mayor que 0.');
      return;
    }
    setSubmitting(true);
    const res = await fetch('/api/driver-orders/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: items.map((i) => ({ product_model_id: i.product_model.id, quantity: i.quantity })),
        notes: notes || undefined,
      }),
    });
    const json = await res.json().catch(() => ({}));
    setSubmitting(false);
    setConfirmOpen(false);
    if (!res.ok) {
      toast.error(json.error || 'Error al enviar la solicitud.');
      return;
    }
    toast.success('Solicitud enviada. El almacén la preparará y te llegará para aceptar.');
    reset();
  }

  const readyItems = cart.filter((i) => i.quantity > 0);

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="text-2xl font-semibold text-slate-900">Solicitar pedido</h1>
      <p className="mt-1 text-sm text-slate-500">
        Busca por referencia lo que necesitas y pon la cantidad. El almacén la revisará, la
        preparará y te la enviará para que la aceptes.
      </p>

      <div className="card mt-6">
        <ModelPicker onSelect={handleSelect} />
      </div>

      {cart.length > 0 && (
        <div className="card mt-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Tu solicitud</h2>
          <div className="space-y-2">
            {cart.map((item) => (
              <div key={item.product_model.id} className="flex items-center justify-between rounded-xl border border-slate-100 px-3 py-2">
                <p className="text-sm font-medium text-slate-900">{item.product_model.brand} {item.product_model.model_name}</p>
                <div className="flex items-center gap-2">
                  <QuantityInput
                    value={item.quantity}
                    onChange={(qty) => updateQty(item.product_model.id, qty)}
                    className="w-16 rounded-lg border border-slate-200 px-2 py-1 text-center text-sm"
                  />
                  <button onClick={() => removeItem(item.product_model.id)} className="text-xs text-red-600">
                    Quitar
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4">
            <label className="label-field">Nota para el almacén (opcional)</label>
            <textarea className="input-field" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <div className="mt-4 flex gap-3">
            <button className="btn-secondary flex-1" onClick={reset}>Cancelar</button>
            <button className="btn-charge flex-1" onClick={() => setConfirmOpen(true)}>Enviar solicitud</button>
          </div>
        </div>
      )}

      <ConfirmModal
        open={confirmOpen}
        title="Enviar solicitud"
        description={`Vas a pedir ${readyItems.length} modelo(s) al almacén. Te llegará para aceptar en cuanto lo preparen.`}
        confirmLabel="Sí, enviar"
        loading={submitting}
        onConfirm={submit}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
