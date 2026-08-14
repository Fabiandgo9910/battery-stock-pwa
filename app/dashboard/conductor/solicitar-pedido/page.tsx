'use client';

import { useState } from 'react';
import BarcodeScanner from '@/components/BarcodeScanner';
import ErrorBoundary from '@/components/ErrorBoundary';
import ConfirmModal from '@/components/ConfirmModal';
import toast from 'react-hot-toast';
import type { ProductModel } from '@/types/domain';

interface CartItem {
  product_model: ProductModel;
  quantity: number;
}

export default function SolicitarPedidoPage() {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [looking, setLooking] = useState(false);
  const [notes, setNotes] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleScan(code: string) {
    setLooking(true);
    try {
      const res = await fetch(`/api/reception/lookup?ean=${encodeURIComponent(code)}`);
      const json = await res.json();
      if (!json.found) {
        toast.error('Este código no está en el catálogo todavía. Avisa al almacén.');
        return;
      }
      const model: ProductModel = json.product_model;
      setCart((prev) => {
        const existing = prev.find((i) => i.product_model.id === model.id);
        if (existing) {
          return prev.map((i) => (i.product_model.id === model.id ? { ...i, quantity: i.quantity + 1 } : i));
        }
        return [...prev, { product_model: model, quantity: 1 }];
      });
      toast.success(`${model.brand} ${model.model_name} añadido`);
    } finally {
      setLooking(false);
    }
  }

  function updateQty(id: string, qty: number) {
    setCart((prev) => prev.map((i) => (i.product_model.id === id ? { ...i, quantity: Math.max(1, qty) } : i)));
  }
  function removeItem(id: string) {
    setCart((prev) => prev.filter((i) => i.product_model.id !== id));
  }
  function reset() {
    setCart([]);
    setNotes('');
  }

  async function submit() {
    setSubmitting(true);
    const res = await fetch('/api/driver-orders/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: cart.map((i) => ({ product_model_id: i.product_model.id, quantity: i.quantity })),
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

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="text-2xl font-semibold text-slate-900">Solicitar pedido</h1>
      <p className="mt-1 text-sm text-slate-500">
        Escanea (o busca) lo que necesitas. El almacén la revisará, la preparará y te la enviará
        para que la aceptes — igual que cuando te la preparan ellos directamente.
      </p>

      <div className="card mt-6">
        <ErrorBoundary fallbackTitle="No se pudo iniciar la cámara. Comprueba los permisos o usa un lector físico.">
          <BarcodeScanner active onScan={handleScan} />
        </ErrorBoundary>
        {looking && <p className="mt-2 text-center text-sm text-charge-700">Buscando modelo…</p>}
      </div>

      {cart.length > 0 && (
        <div className="card mt-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Tu solicitud</h2>
          <div className="space-y-2">
            {cart.map((item) => (
              <div key={item.product_model.id} className="flex items-center justify-between rounded-xl border border-slate-100 px-3 py-2">
                <p className="text-sm font-medium text-slate-900">{item.product_model.brand} {item.product_model.model_name}</p>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    className="w-16 rounded-lg border border-slate-200 px-2 py-1 text-center text-sm"
                    value={item.quantity}
                    onChange={(e) => updateQty(item.product_model.id, Number(e.target.value))}
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
        description={`Vas a pedir ${cart.length} modelo(s) al almacén. Te llegará para aceptar en cuanto lo preparen.`}
        confirmLabel="Sí, enviar"
        loading={submitting}
        onConfirm={submit}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
