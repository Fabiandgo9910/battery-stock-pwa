'use client';

import { useEffect, useState } from 'react';
import Pagination from '@/components/Pagination';
import { usePagination } from '@/hooks/usePagination';
import ConfirmModal from '@/components/ConfirmModal';
import ModelPicker from '@/components/ModelPicker';
import QuantityInput from '@/components/QuantityInput';
import toast from 'react-hot-toast';
import { createBrowserClient } from '@/lib/supabaseClient';
import type { ProductModel } from '@/types/domain';

interface OrderItem {
  id: string;
  product_model_id: string;
  quantity: number;
  product_model: { brand: string; model_name: string } | null;
}
interface Order {
  id: string;
  status: 'requested' | 'pending' | 'accepted' | 'rejected';
  created_at: string;
  responded_at: string | null;
  notes: string | null;
  driver: { full_name: string } | null;
  delivered_by_profile: { full_name: string } | null;
  driver_delivery_items: OrderItem[];
}
interface EditItem {
  product_model: ProductModel;
  quantity: number;
}

const STATUS_LABEL: Record<Order['status'], string> = {
  requested: 'Solicitado por el conductor (por preparar)',
  pending: 'Pendiente de respuesta',
  accepted: 'Aceptado',
  rejected: 'Rechazado',
};
const STATUS_STYLE: Record<Order['status'], string> = {
  requested: 'bg-charge-100 text-charge-700',
  pending: 'bg-amber-100 text-amber-700',
  accepted: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-700',
};

export default function PedidosPendientesPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<'requested' | 'pending' | 'all'>('requested');
  const [searchDriver, setSearchDriver] = useState('');
  const [toCancel, setToCancel] = useState<Order | null>(null);
  const [detailsOrder, setDetailsOrder] = useState<Order | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Procesar una solicitud del conductor
  const [processing, setProcessing] = useState<Order | null>(null);
  const [editItems, setEditItems] = useState<EditItem[]>([]);
  const [editNotes, setEditNotes] = useState('');


  async function load() {
    setLoading(true);
    const res = await fetch(`/api/driver-orders${filterStatus === 'all' ? '' : `?status=${filterStatus}`}`);
    const json = await res.json();
    setOrders(json.orders ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
    const supabase = createBrowserClient();
    const channel = supabase
      .channel('warehouse-orders-list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_deliveries' }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterStatus]);

  async function confirmCancel() {
    if (!toCancel) return;
    setSubmitting(true);
    const res = await fetch(`/api/driver-orders/${toCancel.id}/cancel`, { method: 'POST' });
    const json = await res.json().catch(() => ({}));
    setSubmitting(false);
    setToCancel(null);
    if (!res.ok) {
      toast.error(json.error || 'No se pudo deshacer el pedido.');
      return;
    }
    toast.success('Pedido deshecho. Es como si nunca se hubiera creado.');
    load();
  }

  function startProcessing(order: Order) {
    setProcessing(order);
    setEditItems(
      order.driver_delivery_items.map((it) => ({
        product_model: { id: it.product_model_id, brand: it.product_model?.brand ?? '', model_name: it.product_model?.model_name ?? '' } as ProductModel,
        quantity: it.quantity,
      }))
    );
    setEditNotes(order.notes ?? '');
  }

  function handleSelectForProcessing(model: ProductModel) {
    if (editItems.some((i) => i.product_model.id === model.id)) {
      toast('Ese modelo ya está en el pedido, ajusta su cantidad abajo.');
      return;
    }
    setEditItems((prev) => [...prev, { product_model: model, quantity: 0 }]);
  }

  function updateEditQty(id: string, qty: number) {
    setEditItems((prev) => prev.map((i) => (i.product_model.id === id ? { ...i, quantity: qty } : i)));
  }
  function removeEditItem(id: string) {
    setEditItems((prev) => prev.filter((i) => i.product_model.id !== id));
  }

  async function confirmProcess() {
    if (!processing) return;
    const items = editItems.filter((i) => i.quantity > 0);
    if (items.length === 0) {
      toast.error('El pedido no puede quedar vacío.');
      return;
    }
    setSubmitting(true);
    const res = await fetch(`/api/driver-orders/${processing.id}/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: items.map((i) => ({ product_model_id: i.product_model.id, quantity: i.quantity })),
        notes: editNotes || undefined,
      }),
    });
    const json = await res.json().catch(() => ({}));
    setSubmitting(false);
    if (!res.ok) {
      toast.error(json.error || 'Error al procesar el pedido.');
      return;
    }
    toast.success('Pedido preparado y enviado al conductor para que lo acepte.');
    setProcessing(null);
    load();
  }

  const filtered = orders.filter((o) =>
    (o.driver?.full_name ?? '').toLowerCase().includes(searchDriver.toLowerCase())
  );
  const { page, setPage, pageItems, total } = usePagination(filtered, 10);

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-semibold text-slate-900">Pedidos de conductores</h1>
      <p className="mt-1 text-sm text-slate-500">
        Aquí llegan tanto los pedidos que solicitan los conductores (los tienes que preparar y
        enviar) como los que ya has preparado tú y esperan respuesta.
      </p>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <select
          className="input-field sm:max-w-xs"
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value as any)}
        >
          <option value="requested">Por preparar (solicitados)</option>
          <option value="pending">Pendientes de respuesta</option>
          <option value="all">Todos</option>
        </select>
        <input
          className="input-field"
          placeholder="Buscar por conductor…"
          value={searchDriver}
          onChange={(e) => setSearchDriver(e.target.value)}
        />
      </div>

      <div className="mt-6 space-y-3">
        {loading && <p className="text-sm text-slate-400">Cargando…</p>}
        {!loading && pageItems.length === 0 && (
          <div className="card text-center text-slate-400">No hay pedidos en esta vista.</div>
        )}
        {pageItems.map((order) => (
          <div key={order.id} className="card">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-slate-900">{order.driver?.full_name ?? 'Conductor desconocido'}</p>
                <p className="text-xs text-slate-400">
                  {order.status === 'requested'
                    ? `Solicitado el ${new Date(order.created_at).toLocaleString('es-ES')}`
                    : `Preparado por ${order.delivered_by_profile?.full_name ?? 'almacén'} · ${new Date(order.created_at).toLocaleString('es-ES')}`}
                </p>
              </div>
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLE[order.status]}`}>
                {STATUS_LABEL[order.status]}
              </span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {order.driver_delivery_items.map((item) => (
                <span key={item.id} className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs text-slate-700">
                  {item.product_model?.brand} {item.product_model?.model_name}: <strong>{item.quantity}</strong>
                </span>
              ))}
            </div>
            {order.notes && <p className="mt-2 text-xs text-slate-400">Nota: {order.notes}</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              <button className="btn-secondary" onClick={() => setDetailsOrder(order)}>Ver detalles</button>
              {order.status === 'requested' && (
                <button className="btn-charge" onClick={() => startProcessing(order)}>Preparar y enviar</button>
              )}
              {(order.status === 'requested' || order.status === 'pending') && (
                <button className="btn-secondary text-red-600" onClick={() => setToCancel(order)}>
                  Deshacer pedido
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <Pagination page={page} pageSize={10} total={total} onPageChange={setPage} />

      {/* Modal de detalles */}
      {detailsOrder && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full sm:max-w-md rounded-2xl bg-white p-6 shadow-xl max-h-[85vh] overflow-y-auto">
            <h2 className="text-lg font-semibold text-slate-900">Detalles del pedido</h2>
            <div className="mt-3 space-y-2 text-sm">
              <p><span className="text-slate-500">Conductor:</span> {detailsOrder.driver?.full_name ?? '—'}</p>
              <p><span className="text-slate-500">Estado:</span> {STATUS_LABEL[detailsOrder.status]}</p>
              <p><span className="text-slate-500">Creado:</span> {new Date(detailsOrder.created_at).toLocaleString('es-ES')}</p>
              {detailsOrder.delivered_by_profile && (
                <p><span className="text-slate-500">Preparado por:</span> {detailsOrder.delivered_by_profile.full_name}</p>
              )}
              {detailsOrder.responded_at && (
                <p><span className="text-slate-500">Respondido:</span> {new Date(detailsOrder.responded_at).toLocaleString('es-ES')}</p>
              )}
              {detailsOrder.notes && <p><span className="text-slate-500">Notas:</span> {detailsOrder.notes}</p>}
            </div>
            <div className="mt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Baterías</p>
              <div className="mt-1.5 space-y-1.5">
                {detailsOrder.driver_delivery_items.map((item) => (
                  <div key={item.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
                    <span>{item.product_model?.brand} {item.product_model?.model_name}</span>
                    <strong>{item.quantity}</strong>
                  </div>
                ))}
              </div>
            </div>
            <button className="btn-secondary mt-6 w-full" onClick={() => setDetailsOrder(null)}>Cerrar</button>
          </div>
        </div>
      )}

      {/* Modal de procesar/preparar */}
      {processing && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full sm:max-w-md rounded-2xl bg-white p-6 shadow-xl max-h-[85vh] overflow-y-auto">
            <h2 className="text-lg font-semibold text-slate-900">
              Preparar pedido de {processing.driver?.full_name}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Edita cantidades, quita lo que no haya, o busca por referencia para añadir otro
              modelo (por ejemplo si el conductor pidió uno que no existía en el catálogo).
            </p>

            <div className="mt-4">
              <ModelPicker onSelect={handleSelectForProcessing} />
            </div>

            <div className="mt-4 space-y-2">
              {editItems.map((item) => (
                <div key={item.product_model.id} className="flex items-center justify-between rounded-xl border border-slate-100 px-3 py-2">
                  <p className="text-sm font-medium text-slate-900">{item.product_model.brand} {item.product_model.model_name}</p>
                  <div className="flex items-center gap-2">
                    <QuantityInput
                      value={item.quantity}
                      onChange={(qty) => updateEditQty(item.product_model.id, qty)}
                      className="w-16 rounded-lg border border-slate-200 px-2 py-1 text-center text-sm"
                    />
                    <button onClick={() => removeEditItem(item.product_model.id)} className="text-xs text-red-600">
                      Quitar
                    </button>
                  </div>
                </div>
              ))}
              {editItems.length === 0 && <p className="text-sm text-slate-400">Sin modelos todavía.</p>}
            </div>

            <div className="mt-4">
              <label className="label-field">Nota (opcional)</label>
              <textarea className="input-field" rows={2} value={editNotes} onChange={(e) => setEditNotes(e.target.value)} />
            </div>

            <div className="mt-6 flex gap-3">
              <button className="btn-secondary flex-1" onClick={() => setProcessing(null)}>Cancelar</button>
              <button className="btn-charge flex-1" disabled={submitting} onClick={confirmProcess}>
                {submitting ? 'Enviando…' : 'Enviar al conductor'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        open={!!toCancel}
        title="Deshacer pedido"
        description={`Se cancelará el pedido de ${toCancel?.driver?.full_name ?? 'este conductor'}. No se ha movido ningún stock todavía, así que es como si nunca se hubiera creado.`}
        confirmLabel="Sí, deshacer"
        tone="danger"
        loading={submitting}
        onConfirm={confirmCancel}
        onCancel={() => setToCancel(null)}
      />
    </div>
  );
}
