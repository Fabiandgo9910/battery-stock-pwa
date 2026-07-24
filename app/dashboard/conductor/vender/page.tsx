'use client';

import { useEffect, useState } from 'react';
import BarcodeScanner from '@/components/BarcodeScanner';
import ErrorBoundary from '@/components/ErrorBoundary';
import ConfirmModal from '@/components/ConfirmModal';
import toast from 'react-hot-toast';
import { createBrowserClient } from '@/lib/supabaseClient';
import { useProfile } from '@/hooks/useProfile';
import type { ProductModel } from '@/types/domain';

export default function VenderPage() {
  const supabase = createBrowserClient();
  const { profile } = useProfile();
  const [ean, setEan] = useState('');
  const [model, setModel] = useState<ProductModel | null>(null);
  const [myStock, setMyStock] = useState<number | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [amountCash, setAmountCash] = useState('');
  const [amountCard, setAmountCard] = useState('');
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
    }
    checkStock();
  }, [model, profile, supabase]);

  async function handleScan(code: string) {
    setEan(code);
    const res = await fetch(`/api/reception/lookup?ean=${encodeURIComponent(code)}`);
    const json = await res.json();
    if (!json.found) {
      toast.error('Código no reconocido en el catálogo.');
      reset();
      return;
    }
    setModel(json.product_model);
  }

  function reset() {
    setEan('');
    setModel(null);
    setMyStock(null);
    setQuantity(1);
    setAmountCash('');
    setAmountCard('');
  }

  const total = (Number(amountCash) || 0) + (Number(amountCard) || 0);

  async function submit() {
    if (total <= 0) {
      toast.error('Introduce el importe cobrado.');
      return;
    }
    if (myStock !== null && quantity > myStock) {
      toast.error('No tienes suficiente stock para esta venta.');
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

            <div className="mt-4">
              <label className="label-field">Cantidad</label>
              <input
                type="number"
                min={1}
                max={myStock ?? undefined}
                className="input-field text-lg font-semibold"
                value={quantity}
                onChange={(e) => setQuantity(Number(e.target.value))}
              />
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <div>
                <label className="label-field">💵 Efectivo</label>
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
                <label className="label-field">💳 Tarjeta</label>
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
              <p className="text-xs uppercase tracking-wide text-charge-700">Total cobrado</p>
              <p className="text-2xl font-bold text-slate-900">{total.toFixed(2)} €</p>
            </div>

            <div className="mt-6 flex gap-3">
              <button className="btn-secondary flex-1" onClick={reset}>Cancelar</button>
              <button className="btn-charge flex-1" onClick={() => setConfirmOpen(true)}>Cobrar venta</button>
            </div>
          </>
        )}
      </div>

      <ConfirmModal
        open={confirmOpen}
        title="Confirmar venta"
        description={`${quantity} x ${model?.brand} ${model?.model_name} por un total de ${total.toFixed(2)} €.`}
        confirmLabel="Confirmar cobro"
        loading={submitting}
        onConfirm={submit}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
