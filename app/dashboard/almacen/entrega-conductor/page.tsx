'use client';

import { useEffect, useState } from 'react';
import BarcodeScanner from '@/components/BarcodeScanner';
import ErrorBoundary from '@/components/ErrorBoundary';
import ConfirmModal from '@/components/ConfirmModal';
import toast from 'react-hot-toast';
import { createBrowserClient } from '@/lib/supabaseClient';
import type { ProductModel, Profile } from '@/types/domain';

export default function EntregaConductorPage() {
  const supabase = createBrowserClient();
  const [drivers, setDrivers] = useState<Profile[]>([]);
  const [driverId, setDriverId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [scannerActive, setScannerActive] = useState(true);
  const [ean, setEan] = useState('');
  const [model, setModel] = useState<ProductModel | null>(null);
  const [availableStock, setAvailableStock] = useState<number | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    async function load() {
      const { data: d } = await supabase.from('profiles').select('*').eq('role', 'conductor').eq('active', true).order('full_name');
      setDrivers(d ?? []);
      const { data: wh } = await supabase.from('warehouses').select('*').eq('active', true).limit(1).single();
      if (wh) setWarehouseId(wh.id);
    }
    load();
  }, [supabase]);

  async function handleScan(code: string) {
    setEan(code);
    setScannerActive(false);
    const res = await fetch(`/api/reception/lookup?ean=${encodeURIComponent(code)}`);
    const json = await res.json();
    if (!json.found) {
      toast.error('Este código no está registrado en el catálogo. Debes darlo de alta primero en Recepción.');
      reset();
      return;
    }
    setModel(json.product_model);
    const { data: stock } = await supabase
      .from('warehouse_stock')
      .select('quantity')
      .eq('warehouse_id', warehouseId)
      .eq('product_model_id', json.product_model.id)
      .maybeSingle();
    setAvailableStock(stock?.quantity ?? 0);
  }

  function reset() {
    setEan('');
    setModel(null);
    setAvailableStock(null);
    setQuantity(1);
    setScannerActive(true);
  }

  async function submit() {
    if (!driverId) {
      toast.error('Selecciona un conductor.');
      return;
    }
    setSubmitting(true);
    const res = await fetch('/api/dispatch-driver', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        warehouse_id: warehouseId,
        driver_id: driverId,
        product_model_id: model!.id,
        quantity,
      }),
    });
    const json = await res.json();
    setSubmitting(false);
    setConfirmOpen(false);
    if (!res.ok) {
      toast.error(json.error || 'Error al entregar stock');
      return;
    }
    toast.success('Stock entregado al conductor correctamente.');
    reset();
  }

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="text-2xl font-semibold text-slate-900">Entregar stock a conductor</h1>
      <p className="mt-1 text-sm text-slate-500">Resta del almacén y suma al conductor seleccionado.</p>

      <div className="card mt-6">
        <label className="label-field">Conductor *</label>
        <select className="input-field mb-4" value={driverId} onChange={(e) => setDriverId(e.target.value)}>
          <option value="">Selecciona un conductor…</option>
          {drivers.map((d) => (
            <option key={d.id} value={d.id}>{d.full_name}</option>
          ))}
        </select>

        {!model && (
          <ErrorBoundary fallbackTitle="No se pudo iniciar la cámara. Comprueba los permisos o usa un lector físico.">
            <BarcodeScanner active={scannerActive} onScan={handleScan} />
          </ErrorBoundary>
        )}

        {model && (
          <>
            <div className="rounded-xl bg-slate-50 p-4">
              <p className="font-semibold text-slate-900">{model.brand} {model.model_name}</p>
              <p className="text-sm text-slate-500">Disponible en almacén: <strong>{availableStock}</strong></p>
            </div>
            <div className="mt-4">
              <label className="label-field">Cantidad a entregar</label>
              <input
                type="number"
                min={1}
                max={availableStock ?? undefined}
                className="input-field text-lg font-semibold"
                value={quantity}
                onChange={(e) => setQuantity(Number(e.target.value))}
              />
            </div>
            <div className="mt-6 flex gap-3">
              <button className="btn-secondary flex-1" onClick={reset}>Cancelar</button>
              <button className="btn-charge flex-1" onClick={() => setConfirmOpen(true)}>Entregar</button>
            </div>
          </>
        )}
      </div>

      <ConfirmModal
        open={confirmOpen}
        title="Confirmar entrega"
        description={`Vas a entregar ${quantity} unidades de ${model?.brand} ${model?.model_name} al conductor seleccionado.`}
        confirmLabel="Sí, entregar"
        loading={submitting}
        onConfirm={submit}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
