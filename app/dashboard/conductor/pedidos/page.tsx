'use client';

import { useEffect, useState } from 'react';
import ConfirmModal from '@/components/ConfirmModal';
import Pagination from '@/components/Pagination';
import { usePagination } from '@/hooks/usePagination';
import toast from 'react-hot-toast';

interface OrderItem {
  id: string;
  quantity: number;
  product_model: { brand: string; model_name: string } | null;
}
interface Order {
  id: string;
  status: 'pending' | 'accepted' | 'rejected';
  created_at: string;
  notes: string | null;
  delivered_by_profile: { full_name: string } | null;
  driver_delivery_items: OrderItem[];
}

export default function PedidosConductorPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmTarget, setConfirmTarget] = useState<{ order: Order; accept: boolean } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    setLoading(true);
    const res = await fetch('/api/driver-orders?status=pending');
    const json = await res.json();
    setOrders(json.orders ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function respond() {
    if (!confirmTarget) return;
    setSubmitting(true);
    const res = await fetch(`/api/driver-orders/${confirmTarget.order.id}/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accept: confirmTarget.accept }),
    });
    const json = await res.json().catch(() => ({}));
    setSubmitting(false);
    setConfirmTarget(null);
    if (!res.ok) {
      toast.error(json.error || 'Error al responder al pedido.');
      return;
    }
    toast.success(confirmTarget.accept ? 'Pedido aceptado: ya está en tu stock.' : 'Pedido rechazado.');
    load();
  }

  const { page, setPage, pageItems, total } = usePagination(orders, 10);

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="text-2xl font-semibold text-slate-900">Pedidos pendientes</h1>
      <p className="mt-1 text-sm text-slate-500">
        El almacén te ha preparado estos pedidos. Acéptalos para que las baterías pasen a tu stock,
        o recházalos si no te corresponden.
      </p>

      <div className="mt-6 space-y-4">
        {loading && <p className="text-sm text-slate-400">Cargando…</p>}
        {!loading && orders.length === 0 && (
          <div className="card text-center text-slate-400">No tienes pedidos pendientes.</div>
        )}
        {pageItems.map((order) => (
          <div key={order.id} className="card">
            <p className="text-xs text-slate-400">
              Preparado por {order.delivered_by_profile?.full_name ?? 'almacén'} ·{' '}
              {new Date(order.created_at).toLocaleString('es-ES')}
            </p>
            <div className="mt-3 space-y-1.5">
              {order.driver_delivery_items.map((item) => (
                <div key={item.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
                  <span>{item.product_model?.brand} {item.product_model?.model_name}</span>
                  <strong>{item.quantity}</strong>
                </div>
              ))}
            </div>
            {order.notes && <p className="mt-2 text-xs text-slate-400">Nota: {order.notes}</p>}
            <div className="mt-4 flex gap-3">
              <button
                className="btn-secondary flex-1 text-red-600"
                onClick={() => setConfirmTarget({ order, accept: false })}
              >
                Rechazar
              </button>
              <button
                className="btn-charge flex-1"
                onClick={() => setConfirmTarget({ order, accept: true })}
              >
                Aceptar
              </button>
            </div>
          </div>
        ))}
      </div>

      <Pagination page={page} pageSize={10} total={total} onPageChange={setPage} />

      <ConfirmModal
        open={!!confirmTarget}
        title={confirmTarget?.accept ? 'Aceptar pedido' : 'Rechazar pedido'}
        description={
          confirmTarget?.accept
            ? 'Las baterías de este pedido pasarán a tu stock y se descontarán del almacén.'
            : 'Este pedido quedará rechazado y el almacén no te entregará estas baterías.'
        }
        confirmLabel={confirmTarget?.accept ? 'Sí, aceptar' : 'Sí, rechazar'}
        tone={confirmTarget?.accept ? 'default' : 'danger'}
        loading={submitting}
        onConfirm={respond}
        onCancel={() => setConfirmTarget(null)}
      />
    </div>
  );
}
