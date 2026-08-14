'use client';

import { useEffect, useState } from 'react';
import ConfirmModal from '@/components/ConfirmModal';
import Pagination from '@/components/Pagination';
import { usePagination } from '@/hooks/usePagination';
import toast from 'react-hot-toast';
import { createBrowserClient } from '@/lib/supabaseClient';

interface OrderItem {
  id: string;
  quantity: number;
  product_model: { brand: string; model_name: string } | null;
}
interface Order {
  id: string;
  status: 'requested' | 'pending' | 'accepted' | 'rejected';
  created_at: string;
  notes: string | null;
  delivered_by_profile: { full_name: string } | null;
  driver_delivery_items: OrderItem[];
}

const STATUS_LABEL: Record<Order['status'], string> = {
  requested: 'Solicitado por ti (el almacén lo está preparando)',
  pending: 'Preparado — tienes que responder',
  accepted: 'Aceptado',
  rejected: 'Rechazado',
};

export default function PedidosConductorPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmTarget, setConfirmTarget] = useState<{ order: Order; accept: boolean } | null>(null);
  const [toCancelRequest, setToCancelRequest] = useState<Order | null>(null);
  const [detailsOrder, setDetailsOrder] = useState<Order | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    setLoading(true);
    // Trae tanto lo pendiente de responder como lo que has solicitado y aún no te han enviado.
    const [pendingRes, requestedRes] = await Promise.all([
      fetch('/api/driver-orders?status=pending'),
      fetch('/api/driver-orders?status=requested'),
    ]);
    const pendingJson = await pendingRes.json();
    const requestedJson = await requestedRes.json();
    setOrders([...(requestedJson.orders ?? []), ...(pendingJson.orders ?? [])]);
    setLoading(false);
  }

  useEffect(() => {
    load();

    const supabase = createBrowserClient();
    const channel = supabase
      .channel('driver-orders-list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_deliveries' }, () => load())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
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

  async function confirmCancelRequest() {
    if (!toCancelRequest) return;
    setSubmitting(true);
    const res = await fetch(`/api/driver-orders/${toCancelRequest.id}/cancel`, { method: 'POST' });
    const json = await res.json().catch(() => ({}));
    setSubmitting(false);
    setToCancelRequest(null);
    if (!res.ok) {
      toast.error(json.error || 'No se pudo cancelar la solicitud.');
      return;
    }
    toast.success('Solicitud cancelada.');
    load();
  }

  const { page, setPage, pageItems, total } = usePagination(orders, 10);

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="text-2xl font-semibold text-slate-900">Pedidos</h1>
      <p className="mt-1 text-sm text-slate-500">
        Lo que el almacén te prepara (para aceptar o rechazar) y lo que tú mismo has solicitado
        (a la espera de que lo preparen).
      </p>

      <div className="mt-6 space-y-4">
        {loading && <p className="text-sm text-slate-400">Cargando…</p>}
        {!loading && orders.length === 0 && (
          <div className="card text-center text-slate-400">No tienes pedidos en este momento.</div>
        )}
        {pageItems.map((order) => (
          <div key={order.id} className="card">
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs text-slate-400">
                {order.status === 'requested'
                  ? `Solicitado el ${new Date(order.created_at).toLocaleString('es-ES')}`
                  : `Preparado por ${order.delivered_by_profile?.full_name ?? 'almacén'} · ${new Date(order.created_at).toLocaleString('es-ES')}`}
              </p>
            </div>
            <p className="mt-1 text-xs font-medium text-charge-700">{STATUS_LABEL[order.status]}</p>
            <div className="mt-3 space-y-1.5">
              {order.driver_delivery_items.map((item) => (
                <div key={item.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
                  <span>{item.product_model?.brand} {item.product_model?.model_name}</span>
                  <strong>{item.quantity}</strong>
                </div>
              ))}
            </div>
            {order.notes && <p className="mt-2 text-xs text-slate-400">Nota: {order.notes}</p>}

            <div className="mt-4 flex flex-wrap gap-3">
              <button className="btn-secondary" onClick={() => setDetailsOrder(order)}>Ver detalles</button>
              {order.status === 'pending' && (
                <>
                  <button className="btn-secondary text-red-600" onClick={() => setConfirmTarget({ order, accept: false })}>
                    Rechazar
                  </button>
                  <button className="btn-charge" onClick={() => setConfirmTarget({ order, accept: true })}>
                    Aceptar
                  </button>
                </>
              )}
              {order.status === 'requested' && (
                <button className="btn-secondary text-red-600" onClick={() => setToCancelRequest(order)}>
                  Cancelar solicitud
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <Pagination page={page} pageSize={10} total={total} onPageChange={setPage} />

      {detailsOrder && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full sm:max-w-md rounded-2xl bg-white p-6 shadow-xl max-h-[85vh] overflow-y-auto">
            <h2 className="text-lg font-semibold text-slate-900">Detalles del pedido</h2>
            <div className="mt-3 space-y-2 text-sm">
              <p><span className="text-slate-500">Estado:</span> {STATUS_LABEL[detailsOrder.status]}</p>
              <p><span className="text-slate-500">Fecha:</span> {new Date(detailsOrder.created_at).toLocaleString('es-ES')}</p>
              {detailsOrder.delivered_by_profile && (
                <p><span className="text-slate-500">Preparado por:</span> {detailsOrder.delivered_by_profile.full_name}</p>
              )}
              {detailsOrder.notes && <p><span className="text-slate-500">Notas:</span> {detailsOrder.notes}</p>}
            </div>
            <div className="mt-4 space-y-1.5">
              {detailsOrder.driver_delivery_items.map((item) => (
                <div key={item.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
                  <span>{item.product_model?.brand} {item.product_model?.model_name}</span>
                  <strong>{item.quantity}</strong>
                </div>
              ))}
            </div>
            <button className="btn-secondary mt-6 w-full" onClick={() => setDetailsOrder(null)}>Cerrar</button>
          </div>
        </div>
      )}

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

      <ConfirmModal
        open={!!toCancelRequest}
        title="Cancelar solicitud"
        description="Se cancelará tu solicitud. El almacén ya no la verá pendiente de preparar."
        confirmLabel="Sí, cancelar"
        tone="danger"
        loading={submitting}
        onConfirm={confirmCancelRequest}
        onCancel={() => setToCancelRequest(null)}
      />
    </div>
  );
}
