'use client';

import { useEffect, useState } from 'react';
import BarcodeScanner from '@/components/BarcodeScanner';
import ErrorBoundary from '@/components/ErrorBoundary';
import ModelPicker from '@/components/ModelPicker';
import QuantityInput from '@/components/QuantityInput';
import ConfirmModal from '@/components/ConfirmModal';
import BatteryCodeLabels from '@/components/BatteryCodeLabels';
import toast from 'react-hot-toast';
import { createBrowserClient } from '@/lib/supabaseClient';
import type { DeliveryType, ProductModel, Profile } from '@/types/domain';

interface CartItem {
  product_model: ProductModel;
  quantity: number;
  available: number;
}

const DELIVERY_TYPE_LABEL: Record<DeliveryType, string> = {
  conductor: 'Conductor normal (usa el código propio del conductor)',
  ofi: 'Extraordinaria — OFI',
  web: 'Pedido WEB',
};

export default function EntregaConductorPage() {
  const supabase = createBrowserClient();
  const [drivers, setDrivers] = useState<Profile[]>([]);
  const [driverId, setDriverId] = useState('');
  const [deliveryType, setDeliveryType] = useState<DeliveryType>('conductor');
  const [warehouseId, setWarehouseId] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [looking, setLooking] = useState(false);
  const [manualMode, setManualMode] = useState(false);
  const [generatedUnits, setGeneratedUnits] = useState<any[]>([]);

  useEffect(() => {
    async function load() {
      const { data: d } = await supabase.from('profiles').select('*').eq('role', 'conductor').eq('active', true).order('full_name');
      setDrivers(d ?? []);
      const { data: wh } = await supabase.from('warehouses').select('*').eq('active', true).eq('is_warranty_holding', false).limit(1).single();
      if (wh) setWarehouseId(wh.id);
    }
    load();
  }, [supabase]);

  async function addOrIncrement(model: ProductModel) {
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
        if (existing.quantity >= available) {
          toast.error(`No hay más stock de ${model.brand} ${model.model_name} (disponible: ${available}).`);
          return prev;
        }
        return prev.map((i) =>
          i.product_model.id === model.id ? { ...i, quantity: i.quantity + 1, available } : i
        );
      }
      if (available <= 0) {
        toast.error(`No hay stock de ${model.brand} ${model.model_name} en almacén.`);
        return prev;
      }
      return [...prev, { product_model: model, quantity: 1, available }];
    });
  }

  async function handleScan(code: string) {
    if (!driverId) {
      toast.error('Selecciona antes un conductor.');
      return;
    }
    setLooking(true);
    try {
      const res = await fetch(`/api/reception/lookup?ean=${encodeURIComponent(code)}`);
      const json = await res.json();
      if (!json.found) {
        toast.error('Código no reconocido en el catálogo.');
        return;
      }
      await addOrIncrement(json.product_model);
      toast.success(`Añadida: ${json.product_model.brand} ${json.product_model.model_name}`);
    } finally {
      setLooking(false);
    }
  }

  async function handleManualSelect(model: ProductModel) {
    await addOrIncrement(model);
  }

  function updateQty(id: string, qty: number) {
    setCart((prev) => prev.map((i) => (i.product_model.id === id ? { ...i, quantity: qty } : i)));
  }
  function removeItem(id: string) {
    setCart((prev) => prev.filter((i) => i.product_model.id !== id));
  }
  function resetAll() {
    setCart([]);
    setDriverId('');
    setDeliveryType('conductor');
  }

  async function submit() {
    if (!driverId) {
      toast.error('Selecciona un conductor.');
      return;
    }
    const items = cart.filter((i) => i.quantity > 0);
    if (items.length === 0) {
      toast.error('Añade al menos una batería con cantidad mayor que 0.');
      return;
    }
    const overLimit = items.find((i) => i.quantity > i.available);
    if (overLimit) {
      toast.error(`No hay suficiente stock de ${overLimit.product_model.brand} ${overLimit.product_model.model_name} (disponible: ${overLimit.available}).`);
      return;
    }
    setSubmitting(true);
    const res = await fetch('/api/driver-orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        warehouse_id: warehouseId,
        driver_id: driverId,
        items: items.map((i) => ({ product_model_id: i.product_model.id, quantity: i.quantity })),
        delivery_type: deliveryType,
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
    if (json.battery_units?.length) {
      setGeneratedUnits(json.battery_units);
    }
    resetAll();
  }

  const driverName = drivers.find((d) => d.id === driverId)?.full_name;
  const readyItems = cart.filter((i) => i.quantity > 0);

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="text-2xl font-semibold text-slate-900">Entregar stock a conductor</h1>
      <p className="mt-1 text-sm text-slate-500">
        Escanea el código EAN de cada batería física que preparas — cada unidad quedará con su
        propio code (para etiquetarla) y el conductor tendrá que aceptar el pedido desde su móvil
        antes de que se mueva el stock.
      </p>

      <div className="card mt-6">
        <label className="label-field">Conductor *</label>
        <select className="input-field mb-4" value={driverId} onChange={(e) => setDriverId(e.target.value)}>
          <option value="">Selecciona un conductor…</option>
          {drivers.map((d) => (
            <option key={d.id} value={d.id}>{d.full_name}</option>
          ))}
        </select>

        <label className="label-field">Tipo de entrega *</label>
        <select
          className="input-field mb-4"
          value={deliveryType}
          onChange={(e) => setDeliveryType(e.target.value as DeliveryType)}
        >
          {(Object.entries(DELIVERY_TYPE_LABEL) as [DeliveryType, string][]).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <p className="-mt-3 mb-4 text-xs text-slate-400">
          Solo cambia el código que llevará cada batería (código del conductor, &quot;OFI&quot; si es
          una entrega extraordinaria, o &quot;WEB&quot; si es un pedido web).
        </p>

        <ErrorBoundary fallbackTitle="No se pudo iniciar la cámara. Comprueba los permisos o usa un lector físico.">
          <BarcodeScanner active={!!driverId && !manualMode} onScan={handleScan} />
        </ErrorBoundary>
        {looking && <p className="mt-2 text-center text-sm text-charge-700">Buscando modelo…</p>}

        <button
          type="button"
          className="mt-3 text-xs text-slate-400 underline"
          onClick={() => setManualMode((m) => !m)}
        >
          {manualMode ? 'Volver al escáner' : '¿El escáner no funciona? Buscar manualmente'}
        </button>
        {manualMode && (
          <div className="mt-3">
            <ModelPicker onSelect={handleManualSelect} />
          </div>
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
                  <QuantityInput
                    value={item.quantity}
                    onChange={(qty) => updateQty(item.product_model.id, qty)}
                    max={item.available}
                    className="w-16 rounded-lg border border-slate-200 px-2 py-1 text-center text-sm"
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
        description={`Se enviará un pedido con ${readyItems.length} modelo(s) a ${driverName ?? 'el conductor seleccionado'}. Se generará un code por cada batería. El stock del almacén se descontará solo cuando lo acepte.`}
        confirmLabel="Sí, enviar"
        loading={submitting}
        onConfirm={submit}
        onCancel={() => setConfirmOpen(false)}
      />

      {generatedUnits.length > 0 && (
        <BatteryCodeLabels units={generatedUnits} onClose={() => setGeneratedUnits([])} />
      )}
    </div>
  );
}
