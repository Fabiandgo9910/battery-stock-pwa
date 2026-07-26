'use client';

import { useEffect, useState } from 'react';
import BarcodeScanner from '@/components/BarcodeScanner';
import ErrorBoundary from '@/components/ErrorBoundary';
import ConfirmModal from '@/components/ConfirmModal';
import toast from 'react-hot-toast';
import { createBrowserClient } from '@/lib/supabaseClient';
import type { ProductModel, Profile } from '@/types/domain';

interface CartItem {
  product_model: ProductModel;
  quantity: number;
  available: number;
}

export default function EntregaConductorPage() {
  const supabase = createBrowserClient();
  const [drivers, setDrivers] = useState<Profile[]>([]);
  const [driverId, setDriverId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [looking, setLooking] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    async function load() {
      const { data: d } = await supabase.from('profiles').select('*').eq('role', 'conductor').eq('active', true).order('full_name');
      setDrivers(d ?? []);
      const { data: wh } = await supabase.from('warehouses').select('*').eq('active', true).eq('is_warranty_holding', false).limit(1).single();
      if (wh) setWarehouseId(wh.id);
    }
    load();
  }, [supabase]);

  async function handleScan(code: string) {
    setLooking(true);
    try {
      const res = await fetch(`/api/reception/lookup?ean=${encodeURIComponent(code)}`);
      const json = await res.json();
      if (!json.found) {
        toast.error('Este código no está registrado en el catálogo. Debes darlo de alta primero en Recepción.');
        return;
      }
      const model: ProductModel = json.product_model;
      const { data: stock } = await supabase
        .from('warehouse_stock')
        .select('quantity')
        .eq('warehouse_id', warehouseId)
        .eq('product_model_id', model.id)
        .maybeSingle();
      const available = stock?.quantity ?? 0;

      setCart((prev) => {
        const existing = prev.find((i) => i.product_model.id === model.id);
        if (existing) {
          return prev.map((i) =>
            i.product_model.id === model.id ? { ...i, quantity: Math.min(i.quantity + 1, available) } : i
          );
        }
        return [...prev, { product_model: model, quantity: available > 0 ? 1 : 0, available }];
      });
      toast.success(`${model.brand} ${model.model_name} añadido al pedido`);
    } finally {
      setLooking(false);
    }
  }

  function updateQty(id: string, qty: number) {
    setCart((prev) => prev.map((i) => (i.product_model.id === id ? { ...i, quantity: Math.max(1, Math.min(qty, i.available)) } : i)));
  }
  function removeItem(id: string) {
    setCart((prev) => prev.filter((i) => i.product_model.id !== id));
  }
  function resetAll() {
    setCart([]);
    setDriverId('');
  }

  async function submit() {
    if (!driverId) {
      toast.error('Selecciona un conductor.');
      return;
    }
    setSubmitting(true);
    const res = await fetch('/api/driver-orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        warehouse_id: warehouseId,
        driver_id: driverId,
        items: cart.map((i) => ({ product_model_id: i.product_model.id, quantity: i.quantity })),
      }),
    });
    const json = await res.json();
    setSubmitting(false);
    setConfirmOpen(false);
    if (!res.ok) {
      toast.error(json.error || 'Error al crear el pedido');
      return;
    }
    toast.success('Pedido enviado. El conductor debe aceptarlo para que se mueva el stock.');
    resetAll();
  }

  const driverName = drivers.find((d) => d.id === driverId)?.full_name;

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="text-2xl font-semibold text-slate-900">Entregar stock a conductor</h1>
      <p className="mt-1 text-sm text-slate-500">
        Escanea una o varias baterías para armar el pedido. El conductor tendrá que aceptarlo desde
        su móvil; el stock no se mueve hasta que lo acepte.
      </p>

      <div className="card mt-6">
        <label className="label-field">Conductor *</label>
        <select className="input-field mb-4" value={driverId} onChange={(e) => setDriverId(e.target.value)}>
          <option value="">Selecciona un conductor…</option>
          {drivers.map((d) => (
            <option key={d.id} value={d.id}>{d.full_name}</option>
          ))}
        </select>

        <ErrorBoundary fallbackTitle="No se pudo iniciar la cámara. Comprueba los permisos o usa un lector físico.">
          <BarcodeScanner active onScan={handleScan} />
        </ErrorBoundary>
        {looking && (
          <p className="mt-2 text-center text-sm text-charge-700">Buscando modelo…</p>
        )}
      </div>

      {cart.length > 0 && (
        <div className="card mt-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Pedido {driverName ? `para ${driverName}` : ''}
          </h2>
          <div className="space-y-2">
            {cart.map((item) => (
              <div key={item.product_model.id} className="flex items-center justify-between rounded-xl border border-slate-100 px-3 py-2">
                <div>
                  <p className="text-sm font-medium text-slate-900">{item.product_model.brand} {item.product_model.model_name}</p>
                  <p className="text-xs text-slate-400">Disponible en almacén: {item.available}</p>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={item.available}
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
          <div className="mt-4 flex gap-3">
            <button className="btn-secondary flex-1" onClick={resetAll}>Cancelar</button>
            <button className="btn-charge flex-1" onClick={() => setConfirmOpen(true)}>Enviar pedido</button>
          </div>
        </div>
      )}

      <ConfirmModal
        open={confirmOpen}
        title="Enviar pedido al conductor"
        description={`Se enviará un pedido con ${cart.length} modelo(s) a ${driverName ?? 'el conductor seleccionado'}. El stock del almacén se descontará solo cuando lo acepte.`}
        confirmLabel="Sí, enviar"
        loading={submitting}
        onConfirm={submit}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
