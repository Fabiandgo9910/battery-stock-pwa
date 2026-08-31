'use client';

import { useEffect, useState } from 'react';
import BarcodeScanner from '@/components/BarcodeScanner';
import ErrorBoundary from '@/components/ErrorBoundary';
import ConfirmModal from '@/components/ConfirmModal';
import QuantityInput from '@/components/QuantityInput';
import toast from 'react-hot-toast';
import { createBrowserClient } from '@/lib/supabaseClient';
import type { ProductModel } from '@/types/domain';

type SaleOrigin = 'particular' | 'web' | 'mapfre';

export default function VentaDirectaAlmacenPage() {
  const supabase = createBrowserClient();
  const [warehouseId, setWarehouseId] = useState('');
  const [ean, setEan] = useState('');
  const [model, setModel] = useState<ProductModel | null>(null);
  const [availableStock, setAvailableStock] = useState<number | null>(null);
  const [looking, setLooking] = useState(false);
  const [quantity, setQuantity] = useState(0);
  const [amountCash, setAmountCash] = useState('');
  const [amountCard, setAmountCard] = useState('');
  const [isWarranty, setIsWarranty] = useState(false);
  const [vehiclePlate, setVehiclePlate] = useState('');
  const [vehicleModel, setVehicleModel] = useState('');
  const [batteryCode, setBatteryCode] = useState('');
  const [oldBatteryReturned, setOldBatteryReturned] = useState<'si' | 'no' | ''>('');
  const [oldBatteryReason, setOldBatteryReason] = useState('');
  const [saleOrigin, setSaleOrigin] = useState<SaleOrigin>('particular');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [photosChecked, setPhotosChecked] = useState(false);

  useEffect(() => {
    async function load() {
      const { data: wh } = await supabase.from('warehouses').select('*').eq('active', true).eq('is_warranty_holding', false).limit(1).single();
      if (wh) setWarehouseId(wh.id);
    }
    load();
  }, [supabase]);

  async function handleScan(code: string) {
    setLooking(true);
    setEan(code);
    try {
      const res = await fetch(`/api/reception/lookup?ean=${encodeURIComponent(code)}`);
      const json = await res.json();
      if (!json.found) {
        toast.error('Código no reconocido en el catálogo.');
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
    } finally {
      setLooking(false);
    }
  }

  function reset() {
    setEan('');
    setModel(null);
    setAvailableStock(null);
    setQuantity(0);
    setAmountCash('');
    setAmountCard('');
    setIsWarranty(false);
    setVehiclePlate('');
    setVehicleModel('');
    setBatteryCode('');
    setOldBatteryReturned('');
    setOldBatteryReason('');
    setPhotosChecked(false);
    setSaleOrigin('particular');
  }

  const total = (Number(amountCash) || 0) + (Number(amountCard) || 0);

  async function submit() {
    if (quantity <= 0) {
      toast.error('Indica una cantidad mayor que 0.');
      return;
    }
    if (!isWarranty && total <= 0) {
      toast.error('Introduce el importe cobrado.');
      return;
    }
    if (availableStock !== null && quantity > availableStock) {
      toast.error('No hay suficiente stock en almacén para esta venta.');
      return;
    }
    if (!vehiclePlate.trim()) {
      toast.error('Indica la matrícula del coche.');
      return;
    }
    if (oldBatteryReturned === '') {
      toast.error('Indica si el cliente entrega la batería vieja.');
      return;
    }
    if (oldBatteryReturned === 'no' && !oldBatteryReason.trim()) {
      toast.error('Indica el motivo por el que no entrega la batería vieja.');
      return;
    }
    if (!photosChecked) {
      toast.error('Marca la casilla de fotos antes de continuar.');
      return;
    }
    setSubmitting(true);
    const res = await fetch('/api/warehouse-sale', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        warehouse_id: warehouseId,
        product_model_id: model!.id,
        ean_code: ean,
        quantity,
        amount_cash: Number(amountCash) || 0,
        amount_card: Number(amountCard) || 0,
        is_warranty: isWarranty,
        customer_vehicle_plate: vehiclePlate.trim().toUpperCase(),
        customer_vehicle_model: vehicleModel.trim() || undefined,
        battery_code: batteryCode.trim() || undefined,
        old_battery_returned: oldBatteryReturned === 'si',
        old_battery_reason: oldBatteryReturned === 'no' ? oldBatteryReason.trim() : undefined,
        sale_origin: saleOrigin,
      }),
    });
    const json = await res.json();
    setSubmitting(false);
    setConfirmOpen(false);
    if (!res.ok) {
      toast.error(json.error || 'Error al registrar la venta');
      return;
    }
    toast.success('Venta registrada directamente desde el almacén.');
    reset();
  }

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="text-2xl font-semibold text-slate-900">Venta directa de almacén</h1>
      <p className="mt-1 text-sm text-slate-500">
        Venta a un cliente particular desde el stock del almacén central. No tiene relación con la
        venta comercial (esa es para empresas/talleres por transferencia con factura).
      </p>

      <div className="card mt-6">
        <div className={model ? 'hidden' : ''}>
          <ErrorBoundary fallbackTitle="No se pudo iniciar la cámara. Comprueba los permisos o usa un lector físico.">
            <BarcodeScanner active={!model} onScan={handleScan} />
          </ErrorBoundary>
          {looking && <p className="mt-2 text-center text-sm text-charge-700">Buscando modelo…</p>}
        </div>

        {model && (
          <>
            <div className="rounded-xl bg-slate-50 p-4">
              <p className="font-semibold text-slate-900">{model.brand} {model.model_name}</p>
              <p className="text-sm text-slate-500">Disponible en almacén: <strong>{availableStock}</strong></p>
            </div>

            <div className="mt-4">
              <label className="label-field">Cantidad</label>
              <QuantityInput
                value={quantity}
                onChange={setQuantity}
                max={availableStock ?? undefined}
                className="input-field text-lg font-semibold"
              />
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <div>
                <label className="label-field">Matrícula del coche *</label>
                <input
                  className="input-field uppercase"
                  value={vehiclePlate}
                  onChange={(e) => setVehiclePlate(e.target.value)}
                  placeholder="1234ABC"
                />
              </div>
              <div>
                <label className="label-field">Modelo del coche</label>
                <input
                  className="input-field"
                  value={vehicleModel}
                  onChange={(e) => setVehicleModel(e.target.value)}
                  placeholder="Ej: Renault Clio"
                />
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <div>
                <label className="label-field">Code de batería (opcional)</label>
                <input
                  className="input-field uppercase"
                  value={batteryCode}
                  onChange={(e) => setBatteryCode(e.target.value.toUpperCase())}
                  placeholder="Ej: TK720 SB220801"
                />
              </div>
              <div>
                <label className="label-field">¿Entrega batería vieja? *</label>
                <select
                  className="input-field"
                  value={oldBatteryReturned}
                  onChange={(e) => setOldBatteryReturned(e.target.value as 'si' | 'no')}
                >
                  <option value="">Selecciona…</option>
                  <option value="si">Sí</option>
                  <option value="no">No</option>
                </select>
              </div>
            </div>

            {oldBatteryReturned === 'no' && (
              <div className="mt-4">
                <label className="label-field">¿Por qué no entrega la batería vieja? *</label>
                <input
                  className="input-field"
                  value={oldBatteryReason}
                  onChange={(e) => setOldBatteryReason(e.target.value)}
                  placeholder="Ej: no tenía, se la queda para otro vehículo…"
                />
              </div>
            )}

            <div className="mt-4">
              <label className="label-field">Origen de la venta</label>
              <select className="input-field" value={saleOrigin} onChange={(e) => setSaleOrigin(e.target.value as SaleOrigin)}>
                <option value="particular">Particular</option>
                <option value="web">Web</option>
                <option value="mapfre">Mapfre</option>
              </select>
            </div>

            <div className="mt-4 flex items-center gap-2 rounded-xl border border-charge-200 bg-charge-50 px-4 py-3">
              <input
                id="is-warranty-wh"
                type="checkbox"
                checked={isWarranty}
                onChange={(e) => {
                  setIsWarranty(e.target.checked);
                  if (e.target.checked) {
                    setAmountCash('');
                    setAmountCard('');
                  }
                }}
                className="h-4 w-4 rounded border-slate-300"
              />
              <label htmlFor="is-warranty-wh" className="text-sm text-charge-800">
                Es una garantía (0 € salvo que el cliente pague la diferencia por subir de gama)
              </label>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <div>
                <label className="label-field">💵 Efectivo {isWarranty && '(diferencia)'}</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  className="input-field"
                  value={amountCash}
                  onChange={(e) => setAmountCash(e.target.value)}
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className="label-field">💳 Tarjeta {isWarranty && '(diferencia)'}</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  className="input-field"
                  value={amountCard}
                  onChange={(e) => setAmountCard(e.target.value)}
                  placeholder="0.00"
                />
              </div>
            </div>

            <div className="mt-4 rounded-xl bg-charge-50 px-4 py-3 text-center">
              <p className="text-xs uppercase tracking-wide text-charge-700">
                {isWarranty ? 'Total cobrado (diferencia)' : 'Total cobrado'}
              </p>
              <p className="text-2xl font-bold text-slate-900">{total.toFixed(2)} €</p>
            </div>

            <label className="mt-4 flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={photosChecked}
                onChange={(e) => setPhotosChecked(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300"
              />
              Fotos hechas
            </label>

            <div className="mt-6 flex gap-3">
              <button className="btn-secondary flex-1" onClick={reset}>Cancelar</button>
              <button className="btn-charge flex-1" onClick={() => setConfirmOpen(true)}>
                {isWarranty ? 'Confirmar garantía' : 'Cobrar venta'}
              </button>
            </div>
          </>
        )}
      </div>

      <ConfirmModal
        open={confirmOpen}
        title="Confirmar venta directa"
        description={`${quantity} x ${model?.brand} ${model?.model_name} — ${isWarranty ? `garantía, ${total.toFixed(2)} € de diferencia` : `total ${total.toFixed(2)} €`}.`}
        confirmLabel="Confirmar"
        loading={submitting}
        onConfirm={submit}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
