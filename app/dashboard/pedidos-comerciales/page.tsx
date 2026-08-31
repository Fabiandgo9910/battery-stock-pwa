'use client';

import { useEffect, useState } from 'react';
import Pagination from '@/components/Pagination';
import { usePagination } from '@/hooks/usePagination';
import ConfirmModal from '@/components/ConfirmModal';
import ModelPicker from '@/components/ModelPicker';
import QuantityInput from '@/components/QuantityInput';
import BarcodeScanner from '@/components/BarcodeScanner';
import ErrorBoundary from '@/components/ErrorBoundary';
import toast from 'react-hot-toast';
import { createBrowserClient } from '@/lib/supabaseClient';
import type { ProductModel, UserRole } from '@/types/domain';

interface OrderItem {
  id: string;
  product_model_id: string;
  quantity: number;
  product_model: { brand: string; model_name: string } | null;
}

interface Order {
  id: string;
  status: 'pending' | 'dispatched' | 'cancelled';
  requested_at: string;
  dispatched_at: string | null;
  notes: string | null;
  point_of_sale: { id: string; name: string } | null;
  requested_by_profile: { full_name: string } | null;
  dispatched_by_profile: { full_name: string } | null;
  commercial_order_items: OrderItem[];
}
interface EditItem {
  product_model: ProductModel;
  quantity: number;
}
interface CartItem {
  product_model: ProductModel;
  quantity: number;
}
interface PosOption {
  id: string;
  name: string;
}

const STATUS_LABEL: Record<Order['status'], string> = {
  pending: 'Pendiente de salida',
  dispatched: 'Salida dada',
  cancelled: 'Cancelado',
};
const STATUS_STYLE: Record<Order['status'], string> = {
  pending: 'bg-amber-100 text-amber-700',
  dispatched: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-slate-200 text-slate-600',
};

export default function PedidosComercialesPage() {
  const supabase = createBrowserClient();
  const [role, setRole] = useState<UserRole | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [toCancel, setToCancel] = useState<Order | null>(null);
  const [detailsOrder, setDetailsOrder] = useState<Order | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // --- Preparar y dar salida (almacenero/admin) -----------------------------
  const [processing, setProcessing] = useState<Order | null>(null);
  const [editItems, setEditItems] = useState<EditItem[]>([]);
  const [originalQtyByModel, setOriginalQtyByModel] = useState<Record<string, number>>({});
  const [dispatchConfirmOpen, setDispatchConfirmOpen] = useState(false);
  const [photosChecked, setPhotosChecked] = useState(false);
  const [manualMode, setManualMode] = useState(false);
  const [looking, setLooking] = useState(false);
  const [scannedCount, setScannedCount] = useState(0);

  // --- Nuevo pedido (solo comercial/admin) ---------------------------------
  const [showNewOrder, setShowNewOrder] = useState(false);
  const [warehouseId, setWarehouseId] = useState('');
  const [pointsOfSale, setPointsOfSale] = useState<PosOption[]>([]);
  const [newPosId, setNewPosId] = useState('');
  const [newCart, setNewCart] = useState<CartItem[]>([]);
  const [newNotes, setNewNotes] = useState('');
  const [newConfirmOpen, setNewConfirmOpen] = useState(false);

  const canCreate = role === 'comercial' || role === 'admin';
  const canFulfill = role === 'almacenero' || role === 'admin';

  async function load() {
    setLoading(true);
    const res = await fetch('/api/commercial-orders?status=pending');
    const json = await res.json();
    setOrders(json.orders ?? []);
    setLoading(false);
  }

  useEffect(() => {
    async function loadRole() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const { data } = await supabase.from('profiles').select('role').eq('id', session.user.id).single();
      setRole((data?.role as UserRole) ?? null);
    }
    async function loadCreationData() {
      const { data: wh } = await supabase.from('warehouses').select('*').eq('active', true).eq('is_warranty_holding', false).limit(1).single();
      if (wh) setWarehouseId(wh.id);
      const { data: pos } = await supabase.from('points_of_sale').select('id, name').eq('active', true).order('name');
      setPointsOfSale(pos ?? []);
    }
    loadRole();
    loadCreationData();
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --------------------------- Nuevo pedido --------------------------------
  function handleSelectNew(model: ProductModel) {
    if (newCart.some((i) => i.product_model.id === model.id)) {
      toast('Ese modelo ya está en el pedido, ajusta su cantidad abajo.');
      return;
    }
    setNewCart((prev) => [...prev, { product_model: model, quantity: 0 }]);
  }
  function updateNewQty(id: string, qty: number) {
    setNewCart((prev) => prev.map((i) => (i.product_model.id === id ? { ...i, quantity: qty } : i)));
  }
  function removeNewItem(id: string) {
    setNewCart((prev) => prev.filter((i) => i.product_model.id !== id));
  }
  function resetNewOrder() {
    setNewCart([]);
    setNewNotes('');
    setNewPosId('');
    setShowNewOrder(false);
  }
  async function submitNewOrder() {
    if (!newPosId) {
      toast.error('Selecciona la empresa o taller.');
      return;
    }
    const items = newCart.filter((i) => i.quantity > 0);
    if (items.length === 0) {
      toast.error('Añade al menos una batería con cantidad mayor que 0.');
      return;
    }
    setSubmitting(true);
    const res = await fetch('/api/commercial-orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        point_of_sale_id: newPosId,
        warehouse_id: warehouseId,
        items: items.map((i) => ({ product_model_id: i.product_model.id, quantity: i.quantity })),
        notes: newNotes || undefined,
      }),
    });
    const json = await res.json().catch(() => ({}));
    setSubmitting(false);
    setNewConfirmOpen(false);
    if (!res.ok) {
      toast.error(json.error || 'Error al crear el pedido.');
      return;
    }
    toast.success('Pedido registrado. El almacén le dará salida cuando lo prepare.');
    resetNewOrder();
    if (canFulfill) load();
  }
  const readyNewItems = newCart.filter((i) => i.quantity > 0);

  // --------------------------- Preparar / dar salida -----------------------
  function startProcessing(order: Order) {
    setProcessing(order);
    setPhotosChecked(false);
    setManualMode(false);
    setScannedCount(0);
    setEditItems(
      order.commercial_order_items.map((it) => ({
        product_model: { id: it.product_model_id, brand: it.product_model?.brand ?? '', model_name: it.product_model?.model_name ?? '' } as ProductModel,
        quantity: it.quantity,
      }))
    );
    const original: Record<string, number> = {};
    order.commercial_order_items.forEach((it) => { original[it.product_model_id] = it.quantity; });
    setOriginalQtyByModel(original);
  }

  function capIfNeeded(modelId: string, qty: number): number {
    const cap = originalQtyByModel[modelId];
    if (cap !== undefined && qty > cap) {
      toast.error(`No puedes superar la cantidad pedida para ese modelo (pedidas: ${cap}).`);
      return cap;
    }
    return qty;
  }

  function handleSelect(model: ProductModel) {
    if (editItems.some((i) => i.product_model.id === model.id)) {
      toast('Ese modelo ya está en el pedido, ajusta su cantidad abajo.');
      return;
    }
    setEditItems((prev) => [...prev, { product_model: model, quantity: 0 }]);
  }

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
      let blocked = false;
      setEditItems((prev) => {
        const existing = prev.find((i) => i.product_model.id === model.id);
        if (existing) {
          const cap = originalQtyByModel[model.id];
          if (cap !== undefined && existing.quantity >= cap) {
            blocked = true;
            return prev;
          }
          return prev.map((i) => (i.product_model.id === model.id ? { ...i, quantity: i.quantity + 1 } : i));
        }
        return [...prev, { product_model: model, quantity: 1 }];
      });
      if (blocked) {
        toast.error(`No puedes superar la cantidad pedida para ${model.brand} ${model.model_name} (pedidas: ${originalQtyByModel[model.id]}).`);
        return;
      }
      setScannedCount((c) => c + 1);
      toast.success(`Escaneada: ${model.brand} ${model.model_name}`);
    } finally {
      setLooking(false);
    }
  }

  function updateQty(id: string, qty: number) {
    setEditItems((prev) => prev.map((i) => (i.product_model.id === id ? { ...i, quantity: capIfNeeded(id, qty) } : i)));
  }
  function removeItem(id: string) {
    setEditItems((prev) => prev.filter((i) => i.product_model.id !== id));
  }

  async function confirmDispatch() {
    if (!processing) return;
    const items = editItems.filter((i) => i.quantity > 0);
    if (items.length === 0) {
      toast.error('El pedido no puede quedar vacío.');
      return;
    }
    setSubmitting(true);
    const res = await fetch(`/api/commercial-orders/${processing.id}/dispatch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: items.map((i) => ({ product_model_id: i.product_model.id, quantity: i.quantity })) }),
    });
    const json = await res.json().catch(() => ({}));
    setSubmitting(false);
    setDispatchConfirmOpen(false);
    if (!res.ok) {
      toast.error(json.error || 'Error al dar salida al pedido.');
      return;
    }
    toast.success('Salida registrada. El stock del almacén ya se ha descontado.');
    setProcessing(null);
    load();
  }

  async function confirmCancel() {
    if (!toCancel) return;
    setSubmitting(true);
    const res = await fetch(`/api/commercial-orders/${toCancel.id}/cancel`, { method: 'POST' });
    const json = await res.json().catch(() => ({}));
    setSubmitting(false);
    setToCancel(null);
    if (!res.ok) {
      toast.error(json.error || 'No se pudo cancelar.');
      return;
    }
    toast.success('Pedido cancelado.');
    load();
  }

  const filtered = orders.filter((o) => (o.point_of_sale?.name ?? '').toLowerCase().includes(search.toLowerCase()));
  const { page, setPage, pageItems, total } = usePagination(filtered, 10);

  return (
    <div className="mx-auto max-w-2xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Pedidos comerciales</h1>
          <p className="mt-1 text-sm text-slate-500">
            {canFulfill
              ? 'Pedidos que ha solicitado admin/comercial para una empresa o taller. Prepáralos y dales salida.'
              : 'Pide baterías para una empresa o taller. Esto no mueve stock — el almacén le da salida.'}
          </p>
        </div>
        {canCreate && (
          <button className="btn-charge whitespace-nowrap" onClick={() => setShowNewOrder((v) => !v)}>
            {showNewOrder ? 'Cerrar' : '+ Nuevo pedido'}
          </button>
        )}
      </div>

      {canCreate && showNewOrder && (
        <div className="card mt-6">
          <label className="label-field">Empresa o taller *</label>
          <select className="input-field mb-4" value={newPosId} onChange={(e) => setNewPosId(e.target.value)}>
            <option value="">Selecciona…</option>
            {pointsOfSale.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>

          <ModelPicker onSelect={handleSelectNew} />

          {newCart.length > 0 && (
            <div className="mt-4 space-y-2">
              {newCart.map((item) => (
                <div key={item.product_model.id} className="flex items-center justify-between rounded-xl border border-slate-100 px-3 py-2">
                  <p className="text-sm font-medium text-slate-900">{item.product_model.brand} {item.product_model.model_name}</p>
                  <div className="flex items-center gap-2">
                    <QuantityInput
                      value={item.quantity}
                      onChange={(qty) => updateNewQty(item.product_model.id, qty)}
                      className="w-16 rounded-lg border border-slate-200 px-2 py-1 text-center text-sm"
                    />
                    <button onClick={() => removeNewItem(item.product_model.id)} className="text-xs text-red-600">
                      Quitar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="mt-4">
            <label className="label-field">Nota para el almacén (opcional)</label>
            <textarea className="input-field" rows={2} value={newNotes} onChange={(e) => setNewNotes(e.target.value)} />
          </div>
          <div className="mt-4 flex gap-3">
            <button className="btn-secondary flex-1" onClick={resetNewOrder}>Cancelar</button>
            <button className="btn-charge flex-1" onClick={() => setNewConfirmOpen(true)}>Enviar pedido</button>
          </div>
        </div>
      )}

      {canFulfill && (
        <>
          <input
            className="input-field mt-6"
            placeholder="Buscar por empresa…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <div className="mt-6 space-y-3">
            {loading && <p className="text-sm text-slate-400">Cargando…</p>}
            {!loading && pageItems.length === 0 && (
              <div className="card text-center text-slate-400">No hay pedidos comerciales pendientes.</div>
            )}
            {pageItems.map((order) => (
              <div key={order.id} className="card">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-slate-900">{order.point_of_sale?.name ?? 'Empresa desconocida'}</p>
                    <p className="text-xs text-slate-400">
                      Pedido por {order.requested_by_profile?.full_name ?? '—'} ·{' '}
                      {new Date(order.requested_at).toLocaleString('es-ES')}
                    </p>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLE[order.status]}`}>
                    {STATUS_LABEL[order.status]}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {order.commercial_order_items.map((item) => (
                    <span key={item.id} className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs text-slate-700">
                      {item.product_model?.brand} {item.product_model?.model_name}: <strong>{item.quantity}</strong>
                    </span>
                  ))}
                </div>
                {order.notes && <p className="mt-2 text-xs text-slate-400">Nota: {order.notes}</p>}
                <div className="mt-3 flex flex-wrap gap-2">
                  <button className="btn-secondary" onClick={() => setDetailsOrder(order)}>Ver detalles</button>
                  <button className="btn-charge" onClick={() => startProcessing(order)}>Preparar y dar salida</button>
                  <button className="btn-secondary text-red-600" onClick={() => setToCancel(order)}>Cancelar</button>
                </div>
              </div>
            ))}
          </div>

          <Pagination page={page} pageSize={10} total={total} onPageChange={setPage} />
        </>
      )}

      {detailsOrder && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full sm:max-w-md rounded-2xl bg-white p-6 shadow-xl max-h-[85vh] overflow-y-auto">
            <h2 className="text-lg font-semibold text-slate-900">Detalles del pedido</h2>
            <div className="mt-3 space-y-2 text-sm">
              <p><span className="text-slate-500">Empresa:</span> {detailsOrder.point_of_sale?.name}</p>
              <p><span className="text-slate-500">Pedido por:</span> {detailsOrder.requested_by_profile?.full_name}</p>
              <p><span className="text-slate-500">Fecha:</span> {new Date(detailsOrder.requested_at).toLocaleString('es-ES')}</p>
              {detailsOrder.notes && <p><span className="text-slate-500">Notas:</span> {detailsOrder.notes}</p>}
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

      {processing && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full sm:max-w-md rounded-2xl bg-white p-6 shadow-xl max-h-[85vh] overflow-y-auto">
            <h2 className="text-lg font-semibold text-slate-900">
              Preparar salida para {processing.point_of_sale?.name}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Escanea el código EAN de cada batería física que sacas del almacén. No puedes superar,
              para un modelo que ya estaba en el pedido, la cantidad pedida.
            </p>
            <div className="mt-4">
              <ErrorBoundary fallbackTitle="No se pudo iniciar la cámara. Comprueba los permisos o usa un lector físico.">
                <BarcodeScanner active={!manualMode} onScan={handleScan} />
              </ErrorBoundary>
              {looking && <p className="mt-2 text-center text-sm text-charge-700">Buscando modelo…</p>}
              <button
                type="button"
                className="mt-2 text-xs text-slate-400 underline"
                onClick={() => setManualMode((m) => !m)}
              >
                {manualMode ? 'Volver al escáner' : '¿El escáner no funciona? Buscar manualmente'}
              </button>
              {manualMode && (
                <div className="mt-3">
                  <ModelPicker onSelect={handleSelect} />
                </div>
              )}
            </div>
            <div className="mt-4 space-y-2">
              {editItems.map((item) => (
                <div key={item.product_model.id} className="flex items-center justify-between rounded-xl border border-slate-100 px-3 py-2">
                  <div>
                    <p className="text-sm font-medium text-slate-900">{item.product_model.brand} {item.product_model.model_name}</p>
                    {originalQtyByModel[item.product_model.id] !== undefined && (
                      <p className="text-xs text-slate-400">Pedidas: {originalQtyByModel[item.product_model.id]}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <QuantityInput
                      value={item.quantity}
                      onChange={(qty) => updateQty(item.product_model.id, qty)}
                      max={originalQtyByModel[item.product_model.id]}
                      className="w-16 rounded-lg border border-slate-200 px-2 py-1 text-center text-sm"
                    />
                    <button onClick={() => removeItem(item.product_model.id)} className="text-xs text-red-600">
                      Quitar
                    </button>
                  </div>
                </div>
              ))}
              {editItems.length === 0 && <p className="text-sm text-slate-400">Sin modelos todavía.</p>}
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
              <button className="btn-secondary flex-1" onClick={() => setProcessing(null)}>Cancelar</button>
              <button
                className="btn-charge flex-1"
                onClick={() => {
                  if (scannedCount === 0) {
                    toast.error('Escanea al menos una batería antes de dar salida.');
                    return;
                  }
                  if (!photosChecked) {
                    toast.error('Marca la casilla de fotos antes de dar salida.');
                    return;
                  }
                  setDispatchConfirmOpen(true);
                }}
              >
                Dar salida
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        open={dispatchConfirmOpen}
        title="Confirmar salida de almacén"
        description="Se descontará el stock del almacén para estos modelos y quedará registrada la salida. Esta acción no se puede deshacer."
        confirmLabel="Sí, dar salida"
        loading={submitting}
        onConfirm={confirmDispatch}
        onCancel={() => setDispatchConfirmOpen(false)}
      />

      <ConfirmModal
        open={!!toCancel}
        title="Cancelar pedido comercial"
        description={`Se cancelará el pedido para ${toCancel?.point_of_sale?.name}. No se ha movido stock todavía.`}
        confirmLabel="Sí, cancelar"
        tone="danger"
        loading={submitting}
        onConfirm={confirmCancel}
        onCancel={() => setToCancel(null)}
      />

      <ConfirmModal
        open={newConfirmOpen}
        title="Confirmar pedido comercial"
        description={`Se registrará un pedido con ${readyNewItems.length} modelo(s) para la empresa seleccionada, pendiente de que el almacén le dé salida.`}
        confirmLabel="Sí, enviar"
        loading={submitting}
        onConfirm={submitNewOrder}
        onCancel={() => setNewConfirmOpen(false)}
      />
    </div>
  );
}
