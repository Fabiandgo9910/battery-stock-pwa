'use client';

import { useState } from 'react';
import BarcodeScanner from '@/components/BarcodeScanner';
import ErrorBoundary from '@/components/ErrorBoundary';
import toast from 'react-hot-toast';
import type { ProductModel } from '@/types/domain';

interface InventoryModalProps {
  warehouseId: string;
  onClose: () => void;
  onCounted: () => void;
}

interface CountedItem {
  model: ProductModel;
  previousQty: number;
  newQty: number;
}

/**
 * Hacer inventario: escaneas cada batería, aparece el modelo con su stock
 * actual, introduces la cantidad que has contado físicamente, y se FIJA el
 * stock a ese número (no se suma). Se puede seguir escaneando varias
 * baterías seguidas antes de cerrar.
 */
export default function InventoryModal({ warehouseId, onClose, onCounted }: InventoryModalProps) {
  const [looking, setLooking] = useState(false);
  const [current, setCurrent] = useState<{ model: ProductModel; previousQty: number } | null>(null);
  const [countInput, setCountInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [counted, setCounted] = useState<CountedItem[]>([]);

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
      const stockRes = await fetch(
        `/api/product-models?search=${encodeURIComponent(model.model_name)}&pageSize=20`
      );
      const stockJson = await stockRes.json().catch(() => ({}));
      const full = (stockJson.product_models ?? []).find((m: any) => m.id === model.id);
      setCurrent({ model, previousQty: full?.warehouse_stock?.find((s: any) => !s.warehouse?.is_warranty_holding)?.quantity ?? 0 });
      setCountInput('');
    } finally {
      setLooking(false);
    }
  }

  async function confirmCount() {
    if (!current) return;
    const qty = Number(countInput);
    if (countInput === '' || Number.isNaN(qty) || qty < 0) {
      toast.error('Introduce la cantidad contada (0 o más).');
      return;
    }
    setSaving(true);
    const res = await fetch('/api/inventory/adjust', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        warehouse_id: warehouseId,
        product_model_id: current.model.id,
        new_quantity: qty,
      }),
    });
    const json = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      toast.error(json.error || 'Error al ajustar el stock.');
      return;
    }
    setCounted((prev) => [{ model: current.model, previousQty: current.previousQty, newQty: qty }, ...prev]);
    toast.success(`${current.model.brand} ${current.model.model_name}: stock fijado a ${qty}.`);
    setCurrent(null);
    setCountInput('');
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
      <div className="w-full sm:max-w-lg rounded-2xl bg-white p-6 shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Hacer inventario</h2>
          <button
            className="text-sm text-slate-400"
            onClick={() => {
              onCounted();
              onClose();
            }}
          >
            Terminar
          </button>
        </div>
        <p className="mt-1 text-sm text-slate-500">
          Escanea cada batería, comprueba que es el modelo correcto y escribe cuántas has contado.
        </p>

        {!current && (
          <div className="mt-4">
            <ErrorBoundary fallbackTitle="No se pudo iniciar la cámara. Comprueba los permisos o usa un lector físico.">
              <BarcodeScanner active={!looking} onScan={handleScan} />
            </ErrorBoundary>
            {looking && <p className="mt-2 text-center text-sm text-charge-700">Buscando modelo…</p>}
          </div>
        )}

        {current && (
          <div className="mt-4 rounded-xl border-2 border-charge-200 bg-charge-50 p-4">
            <p className="font-semibold text-slate-900">{current.model.brand} {current.model.model_name}</p>
            <p className="text-xs text-slate-500">Stock actual en el sistema: {current.previousQty}</p>
            <label className="label-field mt-3">Cantidad contada físicamente *</label>
            <input
              type="number"
              min={0}
              autoFocus
              className="input-field"
              value={countInput}
              onChange={(e) => setCountInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && confirmCount()}
            />
            <div className="mt-3 flex gap-3">
              <button className="btn-secondary flex-1" onClick={() => setCurrent(null)}>Cancelar</button>
              <button className="btn-charge flex-1" disabled={saving} onClick={confirmCount}>
                {saving ? 'Guardando…' : 'Fijar stock'}
              </button>
            </div>
          </div>
        )}

        {counted.length > 0 && (
          <div className="mt-6">
            <p className="text-xs font-semibold uppercase text-slate-400">Contadas en esta sesión</p>
            <div className="mt-2 space-y-1.5">
              {counted.map((c, i) => (
                <div key={i} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
                  <span>{c.model.brand} {c.model.model_name}</span>
                  <span className="text-slate-500">
                    {c.previousQty} → <strong className="text-slate-900">{c.newQty}</strong>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <button
          className="btn-secondary mt-6 w-full"
          onClick={() => {
            onCounted();
            onClose();
          }}
        >
          Terminar inventario
        </button>
      </div>
    </div>
  );
}
