'use client';

import { useEffect, useState } from 'react';
import ModelPicker from '@/components/ModelPicker';
import QuantityInput from '@/components/QuantityInput';
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

  function handleSelect(model: ProductModel) {
    if (cart.some((i) => i.product_model.id === model.id)) {
      toast('Ese modelo ya está en el pedido, ajusta su cantidad abajo.');
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
    setPosId('');
  }

  async function submit() {
    if (!posId) {
      toast.error('Selecciona la empresa o taller.');
      return;
    }
    const items = cart.filter((i) => i.quantity > 0);
    if (items.length === 0) {
      toast.error('Añade al menos una batería con cantidad mayor que 0.');
      return;
    }
    setSubmitting(true);
    const res = await fetch('/api/commercial-orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        point_of_sale_id: posId,
        warehouse_id: warehouseId,
        items: items.map((i) => ({ product_model_id: i.product_model.id, quantity: i.quantity })),
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

  const readyItems = cart.filter((i) => i.quantity > 0);

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="text-2xl font-semibold text-slate-900">Nuevo pedido comercial</h1>
      <p className="mt-1 text-sm text-slate-500">
        Pide baterías para una empresa o taller buscando por referencia. Esto no mueve stock
        todavía — el almacén lo prepara y le da salida.
      </p>

      <div className="card mt-6">
        <label className="label-field">Empresa o taller *</label>
        <select className="input-field mb-4" value={posId} onChange={(e) => setPosId(e.target.value)}>
          <option value="">Selecciona…</option>
          {pointsOfSale.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>

        <ModelPicker onSelect={handleSelect} />
      </div>

      {cart.length > 0 && (
        <div className="card mt-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Pedido</h2>
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
            <button className="btn-charge flex-1" onClick={() => setConfirmOpen(true)}>Enviar pedido</button>
          </div>
        </div>
      )}

      <ConfirmModal
        open={confirmOpen}
        title="Confirmar pedido comercial"
        description={`Se registrará un pedido con ${readyItems.length} modelo(s) para la empresa seleccionada, pendiente de que el almacén le dé salida.`}
        confirmLabel="Sí, enviar"
        loading={submitting}
        onConfirm={submit}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
