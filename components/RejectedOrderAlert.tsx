'use client';

import { useEffect, useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import { createBrowserClient } from '@/lib/supabaseClient';

interface OrderItem {
  id: string;
  quantity: number;
  product_model: { brand: string; model_name: string } | null;
}
interface RejectedOrder {
  id: string;
  responded_at: string;
  notes: string | null;
  driver: { full_name: string } | null;
  driver_delivery_items: OrderItem[];
}

/**
 * Se monta para admin/almacenero. En cuanto detecta un pedido que un
 * conductor ha RECHAZADO y que todavía nadie ha marcado como visto, muestra
 * un aviso emergente. Al pulsar "Entendido" se marca como visto y no vuelve
 * a aparecer.
 */
export default function RejectedOrderAlert() {
  const [rejected, setRejected] = useState<RejectedOrder[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const checkRejected = useCallback(async () => {
    try {
      const res = await fetch('/api/driver-orders?status=rejected');
      if (!res.ok) return;
      const json = await res.json();
      const pending = (json.orders ?? []).filter((o: any) => !o.rejection_acknowledged_at);
      setRejected(pending);
    } catch {
      /* silencioso: no bloquea el uso normal de la app */
    }
  }, []);

  useEffect(() => {
    checkRejected();

    // Tiempo real: en cuanto un conductor rechaza un pedido, el aviso salta
    // al instante para admin/almacenero (RLS ya limita a lo que puede ver).
    // Sondeo de respaldo cada 30s por si se pierde la conexión de Realtime.
    const supabase = createBrowserClient();
    const channel = supabase
      .channel('warehouse-rejected-orders')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'driver_deliveries' },
        () => checkRejected()
      )
      .subscribe();

    const interval = setInterval(checkRejected, 30000);
    return () => {
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [checkRejected]);

  const current = rejected[0];

  async function acknowledge() {
    if (!current) return;
    setSubmitting(true);
    const res = await fetch(`/api/driver-orders/${current.id}/acknowledge`, { method: 'POST' });
    setSubmitting(false);
    if (!res.ok) {
      toast.error('No se pudo marcar como visto.');
      return;
    }
    checkRejected();
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
          <span className="text-2xl">⚠️</span>
          <h2 className="text-lg font-semibold text-slate-900">Pedido rechazado</h2>
        </div>
        <p className="text-sm text-slate-600">
          <strong>{current.driver?.full_name ?? 'Un conductor'}</strong> ha rechazado este pedido el{' '}
          {new Date(current.responded_at).toLocaleString('es-ES')}.
        </p>
        <div className="mt-3 space-y-1.5">
          {current.driver_delivery_items.map((item) => (
            <div key={item.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
              <span>{item.product_model?.brand} {item.product_model?.model_name}</span>
              <strong>{item.quantity}</strong>
            </div>
          ))}
        </div>
        {current.notes && <p className="mt-2 text-xs text-slate-400">Nota original: {current.notes}</p>}

        {rejected.length > 1 && (
          <p className="mt-3 text-center text-xs text-charge-700">
            Tienes {rejected.length} rechazos pendientes de revisar.
          </p>
        )}

        <button
          className="btn-charge mt-6 w-full"
          disabled={submitting}
          onClick={acknowledge}
        >
          {submitting ? 'Procesando…' : 'Entendido'}
        </button>
      </div>
    </div>
  );
}
