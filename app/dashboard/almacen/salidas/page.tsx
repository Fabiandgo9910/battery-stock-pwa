'use client';

import { useEffect, useState } from 'react';
import Pagination from '@/components/Pagination';
import { usePagination } from '@/hooks/usePagination';
import DirectDeliveryModal from '@/components/DirectDeliveryModal';
import toast from 'react-hot-toast';
import { createBrowserClient } from '@/lib/supabaseClient';

interface OrderItem {
  id: string;
  quantity: number;
  product_model: { brand: string; model_name: string } | null;
}
interface DispatchedOrder {
  id: string;
  dispatched_at: string | null;
  point_of_sale: { id: string; name: string } | null;
  dispatched_by_profile: { full_name: string } | null;
  commercial_order_items: OrderItem[];
}
interface PosOption {
  id: string;
  name: string;
}

export default function SalidasAlmacenPage() {
  const supabase = createBrowserClient();
  const [orders, setOrders] = useState<DispatchedOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [pointsOfSale, setPointsOfSale] = useState<PosOption[]>([]);
  const [posFilter, setPosFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [detailsOrder, setDetailsOrder] = useState<DispatchedOrder | null>(null);
  const [warehouseId, setWarehouseId] = useState('');
  const [showDirectDelivery, setShowDirectDelivery] = useState(false);

  useEffect(() => {
    async function loadPos() {
      const { data } = await supabase.from('points_of_sale').select('id, name').order('name');
      setPointsOfSale(data ?? []);
    }
    async function loadWarehouse() {
      const { data: wh } = await supabase.from('warehouses').select('*').eq('active', true).eq('is_warranty_holding', false).limit(1).single();
      if (wh) setWarehouseId(wh.id);
    }
    loadPos();
    loadWarehouse();
  }, [supabase]);

  async function load() {
    setLoading(true);
    const params = new URLSearchParams({ status: 'dispatched' });
    if (posFilter) params.set('point_of_sale_id', posFilter);
    if (fromDate) params.set('from', new Date(fromDate).toISOString());
    if (toDate) {
      const end = new Date(toDate);
      end.setHours(23, 59, 59, 999);
      params.set('to', end.toISOString());
    }
    const res = await fetch(`/api/commercial-orders?${params.toString()}`);
    const json = await res.json();
    setOrders(json.orders ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posFilter, fromDate, toDate]);

  function exportCajaComercial() {
    if (!fromDate || !toDate) {
      toast.error('Selecciona un rango de fechas (desde/hasta) para exportar.');
      return;
    }
    window.open(`/api/exports/caja-comercial?from=${fromDate}&to=${toDate}`, '_blank');
  }

  const totalUnits = orders.reduce(
    (sum, o) => sum + o.commercial_order_items.reduce((s, i) => s + i.quantity, 0),
    0
  );

  const { page, setPage, pageItems, total } = usePagination(orders, 15);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Salidas de almacén</h1>
          <p className="mt-1 text-sm text-slate-500">
            Todas las salidas hacia empresas y talleres (pedidos comerciales ya despachados). Filtra por
            empresa y por fecha.
          </p>
        </div>
        <button className="btn-charge whitespace-nowrap" onClick={() => setShowDirectDelivery(true)}>
          + Nueva salida directa
        </button>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <select className="input-field" value={posFilter} onChange={(e) => setPosFilter(e.target.value)}>
          <option value="">Todas las empresas</option>
          {pointsOfSale.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <input type="date" className="input-field" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        <input type="date" className="input-field" value={toDate} onChange={(e) => setToDate(e.target.value)} />
      </div>

      <div className="mt-3 flex justify-end">
        <button className="btn-secondary" onClick={exportCajaComercial}>Exportar caja comercial</button>
      </div>

      <div className="mt-4 card text-center">
        <p className="text-xs uppercase text-slate-400">Total unidades salidas (según filtro)</p>
        <p className="mt-1 text-2xl font-bold text-slate-900">{totalUnits}</p>
      </div>

      <div className="mt-4 space-y-3">
        {loading && <p className="text-sm text-slate-400">Cargando…</p>}
        {!loading && pageItems.length === 0 && (
          <div className="card text-center text-slate-400">No hay salidas con este filtro.</div>
        )}
        {pageItems.map((order) => (
          <div key={order.id} className="card">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-slate-900">{order.point_of_sale?.name ?? '—'}</p>
                <p className="text-xs text-slate-400">
                  Salida dada por {order.dispatched_by_profile?.full_name ?? '—'} ·{' '}
                  {order.dispatched_at ? new Date(order.dispatched_at).toLocaleString('es-ES') : '—'}
                </p>
              </div>
              <button className="btn-secondary" onClick={() => setDetailsOrder(order)}>Ver detalles</button>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {order.commercial_order_items.map((item) => (
                <span key={item.id} className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs text-slate-700">
                  {item.product_model?.brand} {item.product_model?.model_name}: <strong>{item.quantity}</strong>
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      <Pagination page={page} pageSize={15} total={total} onPageChange={setPage} />

      {detailsOrder && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full sm:max-w-md rounded-2xl bg-white p-6 shadow-xl max-h-[85vh] overflow-y-auto">
            <h2 className="text-lg font-semibold text-slate-900">Detalles de la salida</h2>
            <div className="mt-3 space-y-2 text-sm">
              <p><span className="text-slate-500">Empresa:</span> {detailsOrder.point_of_sale?.name}</p>
              <p><span className="text-slate-500">Dada por:</span> {detailsOrder.dispatched_by_profile?.full_name}</p>
              <p>
                <span className="text-slate-500">Fecha:</span>{' '}
                {detailsOrder.dispatched_at ? new Date(detailsOrder.dispatched_at).toLocaleString('es-ES') : '—'}
              </p>
            </div>
            <div className="mt-4 space-y-1.5">
              {detailsOrder.commercial_order_items.map((item) => (
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

      {showDirectDelivery && (
        <DirectDeliveryModal
          pointsOfSale={pointsOfSale}
          warehouseId={warehouseId}
          onClose={() => setShowDirectDelivery(false)}
          onDone={() => {
            setShowDirectDelivery(false);
            load();
          }}
        />
      )}
    </div>
  );
}
