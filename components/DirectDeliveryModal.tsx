'use client';

import { useState } from 'react';
import ConfirmModal from '@/components/ConfirmModal';
import ModelPicker from '@/components/ModelPicker';
import QuantityInput from '@/components/QuantityInput';
import toast from 'react-hot-toast';
import type { ProductModel } from '@/types/domain';

interface CartItem {
  product_model: ProductModel;
  quantity: number;
}
interface PosOption {
  id: string;
  name: string;
}

interface DirectDeliveryModalProps {
  pointsOfSale: PosOption[];
  warehouseId: string;
  /** Si se pasa, la empresa ya viene fija (p.ej. abierto desde la ficha de la empresa) y no se puede cambiar. */
  fixedPointOfSale?: PosOption;
  onClose: () => void;
  onDone: () => void;
}

/**
 * Entrega directa a una empresa/taller: descuenta el almacén al momento, sin
 * pasar por el flujo de "pedido comercial pendiente". Se usa tanto desde
 * Empresas como desde Salidas de almacén.
 */
export default function DirectDeliveryModal({
  pointsOfSale,
  warehouseId,
  fixedPointOfSale,
  onClose,
  onDone,
}: DirectDeliveryModalProps) {
  const [posId, setPosId] = useState(fixedPointOfSale?.id ?? '');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [notes, setNotes] = useState('');
  const [photosChecked, setPhotosChecked] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  function handleSelect(model: ProductModel) {
    if (cart.some((i) => i.product_model.id === model.id)) {
      toast('Ese modelo ya está en la entrega, ajusta su cantidad abajo.');
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

  const readyItems = cart.filter((i) => i.quantity > 0);
  const posName = fixedPointOfSale?.name ?? pointsOfSale.find((p) => p.id === posId)?.name;

  async function confirm() {
    setSubmitting(true);
    const res = await fetch('/api/commercial-orders/direct', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        point_of_sale_id: posId,
        warehouse_id: warehouseId,
        items: readyItems.map((i) => ({ product_model_id: i.product_model.id, quantity: i.quantity })),
        notes: notes || undefined,
      }),
    });
    const json = await res.json().catch(() => ({}));
    setSubmitting(false);
    setConfirmOpen(false);
    if (!res.ok) {
      toast.error(json.error || 'Error al registrar la entrega.');
      return;
    }
    toast.success('Entrega registrada. El stock del almacén ya se ha descontado.');
    onDone();
  }

  return (
    <>
      <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/60 p-4">
        <div className="w-full sm:max-w-md rounded-2xl bg-white p-6 shadow-xl max-h-[85vh] overflow-y-auto">
          <h2 className="text-lg font-semibold text-slate-900">
            Nueva salida directa {posName ? `a ${posName}` : 'a una empresa'}
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Se descuenta el almacén al momento (sin pasar por &quot;pendiente&quot;), sin necesidad de
            crear antes un pedido comercial.
          </p>

          {!fixedPointOfSale && (
            <div className="mt-4">
              <label className="label-field">Empresa o taller *</label>
              <select className="input-field" value={posId} onChange={(e) => setPosId(e.target.value)}>
                <option value="">Selecciona…</option>
                {pointsOfSale.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          )}

          <div className="mt-4">
            <ModelPicker onSelect={handleSelect} />
          </div>

          <div className="mt-4 space-y-2">
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
            {cart.length === 0 && <p className="text-sm text-slate-400">Sin modelos todavía.</p>}
          </div>

          <div className="mt-4">
            <label className="label-field">Nota (opcional)</label>
            <textarea className="input-field" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
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
            <button className="btn-secondary flex-1" onClick={onClose}>Cancelar</button>
            <button
              className="btn-charge flex-1"
              onClick={() => {
                if (!posId) {
                  toast.error('Selecciona la empresa o taller.');
                  return;
                }
                if (readyItems.length === 0) {
                  toast.error('Añade al menos una batería con cantidad mayor que 0.');
                  return;
                }
                if (!photosChecked) {
                  toast.error('Marca la casilla de fotos antes de continuar.');
                  return;
                }
                setConfirmOpen(true);
              }}
            >
              Confirmar entrega
            </button>
          </div>
        </div>
      </div>

      <ConfirmModal
        open={confirmOpen}
        title="Confirmar entrega directa"
        description={`Se descontará el almacén ahora mismo para ${readyItems.length} modelo(s), entregados a ${posName ?? 'la empresa seleccionada'}. Esta acción no se puede deshacer.`}
        confirmLabel="Sí, confirmar"
        loading={submitting}
        onConfirm={confirm}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}
