'use client';

import { useEffect, useState } from 'react';
import BarcodeScanner from '@/components/BarcodeScanner';
import ErrorBoundary from '@/components/ErrorBoundary';
import ConfirmModal from '@/components/ConfirmModal';
import toast from 'react-hot-toast';
import { createBrowserClient } from '@/lib/supabaseClient';
import type { ProductModel } from '@/types/domain';

interface CartItem {
  product_model: ProductModel;
  quantity: number;
}
interface PosOption {
  id: string;
  name: string;
}

export default function NuevoPedidoComercialPage() {
  const supabase = createBrowserClient();
  const [warehouseId, setWarehouseId] = useState('');
  const [pointsOfSale, setPointsOfSale] = useState<PosOption[]>([]);
  const [posId, setPosId] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [looking, setLooking] = useState(false);
  const [notes, setNotes] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    async function load() {
      const { data: wh } = await supabase.from('warehouses').select('*').eq('active', true).eq('is_warranty_holding', false).limit(1).single();
      if (wh) setWarehouseId(wh.id);
      const { data: pos } = await supabase.from('points_of_sale').select('id, name').eq('active', true).order('name');
      setPointsOfSale(pos ?? []);
    }
    load();
  }, [supabase]);

  async function handleScan(code: string) {
    setLooking(true);
    try {
      const res = await fetch(`/api/reception/lookup?ean=${encodeURIComponent(code)}`);
      const json = await res.json();
      if (!json.found) {
        toast.error('Código no reconocido en el catálogo.');
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
    setPosId('');
  }

  async function submit() {
    if (!posId) {
      toast.error('Selecciona la empresa o taller.');
      return;
    }
    setSubmitting(true);
    const res = await fetch('/api/commercial-orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        point_of_sale_id: posId,
        warehouse_id: warehouseId,
        items: cart.map((i) => ({ product_model_id: i.product_model.id, quantity: i.quantity })),
        notes: notes || undefined,
      }),
    });
    const json = await res.json().catch(() => ({}));
    setSubmitting(false);
    setConfirmOpen(false);
    if (!res.ok) {
      toast.error(json.error || 'Error al crear el pedido.');
      return;
    }
    toast.success('Pedido registrado. El almacén le dará salida cuando lo prepare.');
    reset();
  }

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="text-2xl font-semibold text-slate-900">Nuevo pedido comercial</h1>
      <p className="mt-1 text-sm text-slate-500">
        Pide baterías para una empresa o taller. Esto no mueve stock todavía — el almacén lo prepara
        y le da salida (ahí es cuando se descuenta de verdad y queda registrado).
      </p>

      <div className="card mt-6">
        <label className="label-field">Empresa o taller *</label>
        <select className="input-field mb-4" value={posId} onChange={(e) => setPosId(e.target.value)}>
          <option value="">Selecciona…</option>
          {pointsOfSale.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>

        <ErrorBoundary fallbackTitle="No se pudo iniciar la cámara. Comprueba los permisos o usa un lector físico.">
          <BarcodeScanner active onScan={handleScan} />
        </ErrorBoundary>
        {looking && <p className="mt-2 text-center text-sm text-charge-700">Buscando modelo…</p>}
      </div>

      {cart.length > 0 && (
        <div className="card mt-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Pedido</h2>
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
            <button className="btn-charge flex-1" onClick={() => setConfirmOpen(true)}>Enviar pedido</button>
          </div>
        </div>
      )}

      <ConfirmModal
        open={confirmOpen}
        title="Confirmar pedido comercial"
        description={`Se registrará un pedido con ${cart.length} modelo(s) para la empresa seleccionada, pendiente de que el almacén le dé salida.`}
        confirmLabel="Sí, enviar"
        loading={submitting}
        onConfirm={submit}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
