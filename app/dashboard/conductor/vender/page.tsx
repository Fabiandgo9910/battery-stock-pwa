'use client';

import { useEffect, useState } from 'react';
import BarcodeScanner from '@/components/BarcodeScanner';
import ErrorBoundary from '@/components/ErrorBoundary';
import ConfirmModal from '@/components/ConfirmModal';
import toast from 'react-hot-toast';
import { createBrowserClient } from '@/lib/supabaseClient';
import { useProfile } from '@/hooks/useProfile';
import type { ProductModel } from '@/types/domain';

type SaleOrigin = 'particular' | 'web' | 'mapfre';

export default function VenderPage() {
  const supabase = createBrowserClient();
  const { profile } = useProfile();
  const [ean, setEan] = useState('');
  const [model, setModel] = useState<ProductModel | null>(null);
  const [myStock, setMyStock] = useState<number | null>(null);
  const [batteryUnits, setBatteryUnits] = useState<{ id: string; code: string }[]>([]);
  const [selectedUnitId, setSelectedUnitId] = useState('');
  const [looking, setLooking] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [amountCash, setAmountCash] = useState('');
  const [amountCard, setAmountCard] = useState('');
  const [isWarranty, setIsWarranty] = useState(false);
  const [vehiclePlate, setVehiclePlate] = useState('');
  const [vehicleModel, setVehicleModel] = useState('');
  const [oldBatteryReturned, setOldBatteryReturned] = useState<'si' | 'no' | ''>('');
  const [oldBatteryReason, setOldBatteryReason] = useState('');
  const [saleOrigin, setSaleOrigin] = useState<SaleOrigin>('particular');
  const [photoChecks, setPhotoChecks] = useState({
    cuadro: false,
    controlador: false,
    viejaYNueva: false,
    nuevaInstalada: false,
    cobro: false,
  });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    async function checkStock() {
      if (!model || !profile) return;
      const { data } = await supabase
        .from('driver_stock')
        .select('quantity')
        .eq('driver_id', profile.id)
        .eq('product_model_id', model.id)
        .maybeSingle();
      setMyStock(data?.quantity ?? 0);

      // Codes de las baterías de este modelo que aún llevo sin montar, para
      // que elija exactamente cuál está instalando (queda guardado en la venta).
      const { data: units } = await supabase
        .from('battery_units')
        .select('id, code')
        .eq('driver_id', profile.id)
        .eq('product_model_id', model.id)
        .eq('status', 'assigned')
        .order('code');
      setBatteryUnits(units ?? []);
      setSelectedUnitId('');
    }
    checkStock();
  }, [model, profile, supabase]);

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
    } finally {
      setLooking(false);
    }
  }

  function reset() {
    setEan('');
    setModel(null);
    setMyStock(null);
    setBatteryUnits([]);
    setSelectedUnitId('');
    setQuantity(1);
    setAmountCash('');
    setAmountCard('');
    setIsWarranty(false);
    setVehiclePlate('');
    setVehicleModel('');
    setOldBatteryReturned('');
    setOldBatteryReason('');
    setSaleOrigin('particular');
    setPhotoChecks({ cuadro: false, controlador: false, viejaYNueva: false, nuevaInstalada: false, cobro: false });
  }

  const total = (Number(amountCash) || 0) + (Number(amountCard) || 0);

  async function submit() {
    if (!isWarranty && total <= 0) {
      toast.error('Introduce el importe cobrado.');
      return;
    }
    if (myStock !== null && quantity > myStock) {
      toast.error('No tienes suficiente stock para esta venta.');
      return;
    }
    if (batteryUnits.length > 0 && !selectedUnitId) {
      toast.error('Selecciona el code de la batería exacta que estás montando.');
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
    if (!Object.values(photoChecks).every(Boolean)) {
      toast.error('Marca las 5 fotos antes de continuar (cuadro, controlador, vieja y nueva, nueva instalada, cobro).');
      return;
    }
    setSubmitting(true);
    const res = await fetch('/api/driver-sale', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        product_model_id: model!.id,
        ean_code: ean,
        quantity,
        amount_cash: Number(amountCash) || 0,
        amount_card: Number(amountCard) || 0,
        is_warranty: isWarranty,
        customer_vehicle_plate: vehiclePlate.trim().toUpperCase(),
        customer_vehicle_model: vehicleModel.trim() || undefined,
        old_battery_returned: oldBatteryReturned === 'si',
        old_battery_reason: oldBatteryReturned === 'no' ? oldBatteryReason.trim() : undefined,
        sale_origin: saleOrigin,
        battery_unit_id: selectedUnitId || undefined,
      }),
    });
    const json = await res.json();
    setSubmitting(false);
    setConfirmOpen(false);
    if (!res.ok) {
      toast.error(json.error || 'Error al registrar la venta');
      return;
    }
    toast.success('Venta registrada. Se ha actualizado tu caja.');
    reset();
  }

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="text-2xl font-semibold text-slate-900">Vender batería</h1>
      <p className="mt-1 text-sm text-slate-500">
        Venta a un cliente particular, desde el stock que llevas en tu furgoneta (el que te entregó el almacén).
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
              <p className="text-sm text-slate-500">
                {model.amperage_ah ? `${model.amperage_ah} Ah` : ''}
                {model.battery_tech ? ` · ${model.battery_tech.toUpperCase()}` : ''}
              </p>
              <p className="mt-1 text-sm text-slate-500">Tienes en tu furgoneta: <strong>{myStock ?? '…'}</strong></p>
            </div>

            {batteryUnits.length > 0 && (
              <div className="mt-4 rounded-xl border border-charge-200 bg-charge-50 p-4">
                <label className="label-field text-charge-800">
                  Code de la batería que vas a montar *
                </label>
                <p className="mb-2 text-xs text-charge-700">
                  Mira el code pegado en la batería y selecciónalo aquí.
                </p>
                <select
                  className="input-field"
                  value={selectedUnitId}
                  onChange={(e) => setSelectedUnitId(e.target.value)}
                >
                  <option value="">Selecciona el code…</option>
                  {batteryUnits.map((u) => (
                    <option key={u.id} value={u.id}>{u.code}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="mt-4">
              <label className="label-field">Cantidad (siempre 1 en venta de conductor)</label>
              <input
                type="number"
                value={1}
                disabled
                className="input-field text-lg font-semibold bg-slate-100 text-slate-500"
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

            <div className="mt-4">
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
                <option value="particular">Particular (en la calle)</option>
                <option value="web">Web</option>
                <option value="mapfre">Mapfre</option>
              </select>
            </div>

            <div className="mt-4 flex items-center gap-2 rounded-xl border border-charge-200 bg-charge-50 px-4 py-3">
              <input
                id="is-warranty"
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
              <label htmlFor="is-warranty" className="text-sm text-charge-800">
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
              {isWarranty && total === 0 && (
                <p className="mt-1 text-xs text-charge-700">Garantía sin coste para el cliente</p>
              )}
            </div>

            <div className="mt-4 space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Fotos tomadas</p>
              {([
                ['cuadro', 'Foto cuadro'],
                ['controlador', 'Foto controlador'],
                ['viejaYNueva', 'Foto vieja y nueva'],
                ['nuevaInstalada', 'Foto de nueva instalada'],
                ['cobro', 'Foto del cobro'],
              ] as const).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={photoChecks[key]}
                    onChange={(e) => setPhotoChecks((prev) => ({ ...prev, [key]: e.target.checked }))}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  {label}
                </label>
              ))}
            </div>

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
        title="Confirmar venta"
        description={`${quantity} x ${model?.brand} ${model?.model_name} — ${isWarranty ? `garantía, ${total.toFixed(2)} € de diferencia` : `total ${total.toFixed(2)} €`}. Matrícula: ${vehiclePlate.toUpperCase()}.`}
        confirmLabel="Confirmar"
        loading={submitting}
        onConfirm={submit}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
