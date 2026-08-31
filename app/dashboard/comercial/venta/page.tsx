'use client';

import { useEffect, useState } from 'react';
import BarcodeScanner from '@/components/BarcodeScanner';
import ErrorBoundary from '@/components/ErrorBoundary';
import ConfirmModal from '@/components/ConfirmModal';
import toast from 'react-hot-toast';
import { createBrowserClient } from '@/lib/supabaseClient';
import { useRouter } from 'next/navigation';
import type { ProductModel } from '@/types/domain';

interface CartItem {
  product_model: ProductModel;
  ean_code: string;
  quantity: number;
}
interface PosOption {
  id: string;
  name: string;
}

export default function VentaComercialPage() {
  const supabase = createBrowserClient();
  const router = useRouter();
  const [warehouseId, setWarehouseId] = useState('');
  const [pointsOfSale, setPointsOfSale] = useState<PosOption[]>([]);
  const [posId, setPosId] = useState('');
  const [scannerActive, setScannerActive] = useState(true);
  const [cart, setCart] = useState<CartItem[]>([]);
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
    const res = await fetch(`/api/reception/lookup?ean=${encodeURIComponent(code)}`);
    const json = await res.json();
    if (!json.found) {
      toast.error('Código no reconocido en el catálogo.');
      return;
    }
    setCart((prev) => {
      const existing = prev.find((i) => i.product_model.id === json.product_model.id);
      if (existing) {
        return prev.map((i) =>
          i.product_model.id === json.product_model.id ? { ...i, quantity: i.quantity + 1 } : i
        );
      }
      return [...prev, { product_model: json.product_model, ean_code: code, quantity: 1 }];
    });
    toast.success(`${json.product_model.brand} ${json.product_model.model_name} añadido`);
  }

  function updateQty(id: string, qty: number) {
    setCart((prev) => prev.map((i) => (i.product_model.id === id ? { ...i, quantity: Math.max(1, qty) } : i)));
  }
  function removeItem(id: string) {
    setCart((prev) => prev.filter((i) => i.product_model.id !== id));
  }

  async function submitSale() {
    if (!posId) {
      toast.error('Selecciona el venta comercial / cliente.');
      return;
    }
    setSubmitting(true);
    const res = await fetch('/api/commercial-sale', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        warehouse_id: warehouseId,
        point_of_sale_id: posId,
        items: cart.map((i) => ({
          product_model_id: i.product_model.id,
          ean_code: i.ean_code,
          quantity: i.quantity,
        })),
      }),
    });
    const json = await res.json();
    setSubmitting(false);
    setConfirmOpen(false);
    if (!res.ok) {
      toast.error(json.error || 'Error al registrar la venta');
      return;
    }
    toast.success('Venta registrada. Factura generada en borrador.');
    setCart([]);
    router.push(`/dashboard/comercial/venta`);
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-semibold text-slate-900">Venta comercial</h1>
      <p className="mt-1 text-sm text-slate-500">
        Venta a otra empresa o taller, directamente del stock del almacén central (no de tu propio stock),
        siempre por transferencia bancaria. Escanea todos los productos y luego genera la factura.
      </p>

      <div className="card mt-6">
        <label className="label-field">Empresa o taller (cliente) *</label>
        <select className="input-field mb-4" value={posId} onChange={(e) => setPosId(e.target.value)}>
          <option value="">Selecciona…</option>
          {pointsOfSale.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>

        <ErrorBoundary fallbackTitle="No se pudo iniciar la cámara. Comprueba los permisos o usa un lector físico.">
          <BarcodeScanner active={scannerActive} onScan={handleScan} />
        </ErrorBoundary>
      </div>

      {cart.length > 0 && (
        <div className="card mt-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Carrito</h2>
          <div className="space-y-2">
            {cart.map((item) => (
              <div key={item.product_model.id} className="flex items-center justify-between rounded-xl border border-slate-100 px-3 py-2">
                <div>
                  <p className="text-sm font-medium text-slate-900">{item.product_model.brand} {item.product_model.model_name}</p>
                  <p className="text-xs text-slate-400">EAN: {item.ean_code}</p>
                </div>
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
          <button className="btn-charge mt-4 w-full" onClick={() => setConfirmOpen(true)}>
            Generar factura (precios en blanco)
          </button>
        </div>
      )}

      <ConfirmModal
        open={confirmOpen}
        title="Confirmar venta comercial"
        description={`Se descontará el stock del almacén y se generará una factura en borrador con ${cart.length} línea(s), lista para que edites los precios.`}
        confirmLabel="Sí, generar factura"
        loading={submitting}
        onConfirm={submitSale}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
