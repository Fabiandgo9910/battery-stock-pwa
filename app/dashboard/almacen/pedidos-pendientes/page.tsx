'use client';

import { useEffect, useState } from 'react';
import Pagination from '@/components/Pagination';
import { usePagination } from '@/hooks/usePagination';
import ConfirmModal from '@/components/ConfirmModal';
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
  responded_at: string | null;
  notes: string | null;
  driver: { full_name: string } | null;
  delivered_by_profile: { full_name: string } | null;
  driver_delivery_items: OrderItem[];
}

const STATUS_LABEL: Record<Order['status'], string> = {
  pending: 'Pendiente de respuesta',
  accepted: 'Aceptado',
  rejected: 'Rechazado',
};
const STATUS_STYLE: Record<Order['status'], string> = {
  pending: 'bg-amber-100 text-amber-700',
  accepted: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-700',
};

export default function PedidosPendientesPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<'pending' | 'all'>('pending');
  const [searchDriver, setSearchDriver] = useState('');
  const [toCancel, setToCancel] = useState<Order | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    setLoading(true);
    const res = await fetch(`/api/driver-orders${filterStatus === 'pending' ? '?status=pending' : ''}`);
    const json = await res.json();
    setOrders(json.orders ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
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

  const filtered = orders.filter((o) =>
    (o.driver?.full_name ?? '').toLowerCase().includes(searchDriver.toLowerCase())
  );
  const { page, setPage, pageItems, total } = usePagination(filtered, 10);

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-semibold text-slate-900">Pedidos pendientes</h1>
      <p className="mt-1 text-sm text-slate-500">
        Pedidos preparados para conductores que todavía no han aceptado o rechazado. Puedes deshacer
        un pedido mientras siga pendiente (antes de que el conductor responda).
      </p>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <select
          className="input-field sm:max-w-xs"
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value as 'pending' | 'all')}
        >
          <option value="pending">Solo pendientes</option>
          <option value="all">Todos (pendientes, aceptados, rechazados)</option>
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
          <div className="card text-center text-slate-400">
            {filterStatus === 'pending' ? 'No hay pedidos pendientes ahora mismo.' : 'Sin pedidos.'}
          </div>
        )}
        {pageItems.map((order) => (
          <div key={order.id} className="card">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-slate-900">{order.driver?.full_name ?? 'Conductor desconocido'}</p>
                <p className="text-xs text-slate-400">
                  Preparado por {order.delivered_by_profile?.full_name ?? 'almacén'} ·{' '}
                  {new Date(order.created_at).toLocaleString('es-ES')}
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
            {order.status === 'pending' && (
              <button
                className="btn-secondary mt-3 text-red-600"
                onClick={() => setToCancel(order)}
              >
                Deshacer pedido
              </button>
            )}
          </div>
        ))}
      </div>

      <Pagination page={page} pageSize={10} total={total} onPageChange={setPage} />

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
