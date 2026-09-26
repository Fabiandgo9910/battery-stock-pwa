'use client';

import { useEffect, useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import { createBrowserClient } from '@/lib/supabaseClient';

interface OrderItem {
  id: string;
  quantity: number;
  product_model: { brand: string; model_name: string } | null;
}
interface Order {
  id: string;
  created_at: string;
  notes: string | null;
  delivered_by_profile: { full_name: string } | null;
  driver_delivery_items: OrderItem[];
}

/**
 * Se monta una sola vez para el rol conductor (en el layout del dashboard).
 * En cuanto detecta un pedido "pending", muestra un modal que NO se puede
 * cerrar sin responder (sin botón de cerrar, sin click-fuera-para-cerrar):
 * el conductor tiene que aceptar o rechazar antes de seguir usando la app.
 * Si hay varios pedidos pendientes, los va mostrando uno a uno.
 */
export default function PendingOrderGate() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [rejectConfirm, setRejectConfirm] = useState(false);

  const checkPending = useCallback(async () => {
    try {
      const res = await fetch('/api/driver-orders?status=pending');
      if (!res.ok) return;
      const json = await res.json();
      setOrders(json.orders ?? []);
    } catch {
      /* si falla la comprobación, no bloqueamos al usuario por un problema de red */
    }
  }, []);

  useEffect(() => {
    checkPending();

    // Tiempo real: en cuanto el almacén crea un pedido nuevo para este
    // conductor, aparece al instante (RLS ya filtra a solo sus propios
    // pedidos). Se mantiene además un sondeo de respaldo cada 30s por si la
    // conexión de Realtime se pierde momentáneamente.
    const supabase = createBrowserClient();
    const channel = supabase
      .channel('driver-pending-orders')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'driver_deliveries' },
        () => checkPending()
      )
      .subscribe();

    const interval = setInterval(checkPending, 30000);
    return () => {
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [checkPending]);

  const current = orders[0];

  async function respond(accept: boolean) {
    if (!current) return;
    setSubmitting(true);
    const res = await fetch(`/api/driver-orders/${current.id}/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accept }),
    });
    const json = await res.json().catch(() => ({}));
    setSubmitting(false);
    setRejectConfirm(false);
    if (!res.ok) {
      toast.error(json.error || 'Error al responder al pedido.');
      return;
    }
    toast.success(accept ? 'Pedido aceptado: ya está en tu stock.' : 'Pedido rechazado.');
    checkPending();
  }

  if (!current) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/80 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
        <div className="mb-3 flex items-center gap-2">
          <span className="text-2xl">📦</span>
          <h2 className="text-lg font-semibold text-slate-900">Tienes un pedido nuevo</h2>
        </div>
        <p className="text-sm text-slate-500">
          Preparado por {current.delivered_by_profile?.full_name ?? 'almacén'} ·{' '}
          {new Date(current.created_at).toLocaleString('es-ES')}
        </p>
        <div className="mt-3 space-y-1.5">
          {current.driver_delivery_items.map((item) => (
            <div key={item.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
              <span>{item.product_model?.brand} {item.product_model?.model_name}</span>
              <strong>{item.quantity}</strong>
            </div>
          ))}
        </div>
        {current.notes && <p className="mt-2 text-xs text-slate-400">Nota: {current.notes}</p>}

        {orders.length > 1 && (
          <p className="mt-3 text-center text-xs text-charge-700">
            Tienes {orders.length} pedidos pendientes en total — los verás uno a uno.
          </p>
        )}

        {!rejectConfirm ? (
          <div className="mt-6 flex gap-3">
            <button
              className="flex-1 rounded-xl border border-red-200 px-4 py-2.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
              disabled={submitting}
              onClick={() => setRejectConfirm(true)}
            >
              Rechazar
            </button>
            <button
              className="btn-charge flex-1"
              disabled={submitting}
              onClick={() => respond(true)}
            >
              {submitting ? 'Procesando…' : 'Aceptar'}
            </button>
          </div>
        ) : (
          <div className="mt-6">
            <p className="mb-3 text-center text-sm text-slate-600">
              ¿Seguro? El almacén verá que has rechazado este pedido.
            </p>
            <div className="flex gap-3">
              <button
                className="btn-secondary flex-1"
                disabled={submitting}
                onClick={() => setRejectConfirm(false)}
              >
                Volver
              </button>
              <button
                className="flex-1 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                disabled={submitting}
                onClick={() => respond(false)}
              >
                {submitting ? 'Procesando…' : 'Sí, rechazar'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
