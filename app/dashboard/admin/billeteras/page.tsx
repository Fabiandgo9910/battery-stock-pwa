'use client';

import { useEffect, useState } from 'react';
import ConfirmModal from '@/components/ConfirmModal';
import QuantityInput from '@/components/QuantityInput';
import Pagination from '@/components/Pagination';
import { usePagination } from '@/hooks/usePagination';
import toast from 'react-hot-toast';

interface StockRow {
  product_model_id: string;
  quantity: number;
  product_model: {
    brand: string;
    model_name: string;
    product_ean_codes?: { ean_code: string }[];
  } | null;
}
interface DriverRow {
  driver: { id: string; full_name: string; vehicle_plate: string | null; zone: string | null; active: boolean };
  wallet: { cash_balance: number; card_balance: number; last_reset_at: string | null };
  stock: StockRow[];
}

interface OfficeWallet {
  cash_balance: number;
  card_balance: number;
  last_reset_at: string | null;
}

export default function BilleterasAdminPage() {
  const [rows, setRows] = useState<DriverRow[]>([]);
  const [office, setOffice] = useState<OfficeWallet | null>(null);
  const [officeResetOpen, setOfficeResetOpen] = useState(false);
  const [target, setTarget] = useState<DriverRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [searchDriver, setSearchDriver] = useState('');
  const [searchBattery, setSearchBattery] = useState('');

  const [reclaimTarget, setReclaimTarget] = useState<{ driver: DriverRow['driver']; stock: StockRow } | null>(null);
  const [reclaimQty, setReclaimQty] = useState(0);
  const [reclaimConfirmOpen, setReclaimConfirmOpen] = useState(false);

  async function load() {
    setLoading(true);
    const res = await fetch('/api/admin/driver-overview');
    const json = await res.json();
    setRows(json.drivers ?? []);
    const officeRes = await fetch('/api/admin/office-wallet');
    const officeJson = await officeRes.json().catch(() => ({}));
    if (officeRes.ok) setOffice(officeJson.wallet);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function confirmOfficeReset() {
    setSubmitting(true);
    const res = await fetch('/api/admin/office-wallet', { method: 'POST' });
    setSubmitting(false);
    setOfficeResetOpen(false);
    if (!res.ok) {
      toast.error('No se pudo reiniciar la caja de oficina.');
      return;
    }
    toast.success('Caja de oficina reiniciada correctamente.');
    load();
  }

  async function confirmReset() {
    if (!target) return;
    setSubmitting(true);
    const res = await fetch('/api/wallet-reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ driver_id: target.driver.id }),
    });
    setSubmitting(false);
    setTarget(null);
    if (!res.ok) {
      toast.error('No se pudo reiniciar la caja.');
      return;
    }
    toast.success(`Caja de ${target.driver.full_name} reiniciada correctamente.`);
    load();
  }

  function openReclaim(driver: DriverRow['driver'], stock: StockRow) {
    setReclaimTarget({ driver, stock });
    setReclaimQty(0);
  }

  async function confirmReclaim() {
    if (!reclaimTarget) return;
    if (reclaimQty <= 0) {
      toast.error('Indica una cantidad mayor que 0.');
      return;
    }
    setSubmitting(true);
    const res = await fetch('/api/admin/reclaim-driver-stock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        driver_id: reclaimTarget.driver.id,
        product_model_id: reclaimTarget.stock.product_model_id,
        quantity: reclaimQty,
      }),
    });
    const json = await res.json().catch(() => ({}));
    setSubmitting(false);
    setReclaimConfirmOpen(false);
    if (!res.ok) {
      toast.error(json.error || 'Error al retirar el stock.');
      return;
    }
    toast.success('Stock retirado y devuelto al almacén.');
    setReclaimTarget(null);
    load();
  }

  const filtered = rows
    .filter((r) => r.driver.full_name.toLowerCase().includes(searchDriver.toLowerCase()))
    .filter((r) => {
      if (!searchBattery.trim()) return true;
      const q = searchBattery.toLowerCase();
      return r.stock.some((s) => {
        const text = `${s.product_model?.brand ?? ''} ${s.product_model?.model_name ?? ''} ${(s.product_model?.product_ean_codes ?? [])
          .map((e) => e.ean_code)
          .join(' ')}`.toLowerCase();
        return text.includes(q);
      });
    });

  const { page, setPage, pageItems, total } = usePagination(filtered, 10);

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold text-slate-900">Conductores: caja y stock</h1>
      <p className="mt-1 text-sm text-slate-500">
        Consulta lo que lleva cada conductor y su caja acumulada. Reinicia la caja individualmente
        cuando el conductor te haya entregado el dinero recaudado, o retírale stock si es necesario
        (vuelve al almacén central).
      </p>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <input
          className="input-field"
          placeholder="Buscar por conductor…"
          value={searchDriver}
          onChange={(e) => setSearchDriver(e.target.value)}
        />
        <input
          className="input-field"
          placeholder="Buscar por batería (marca/modelo/EAN)… muestra quién la lleva"
          value={searchBattery}
          onChange={(e) => setSearchBattery(e.target.value)}
        />
      </div>

      {office && (
        <div className="card mt-6 border-2 border-charge-200">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="font-semibold text-slate-900">🏢 Caja de oficina</p>
              <p className="text-xs text-slate-400">Dinero recaudado en venta directa de almacén.</p>
            </div>
            <button
              className="btn-secondary"
              onClick={() => setOfficeResetOpen(true)}
              disabled={office.cash_balance + office.card_balance === 0}
            >
              Reiniciar caja
            </button>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-slate-50 py-2">
              <p className="text-[11px] uppercase text-slate-400">💵 Efectivo</p>
              <p className="font-semibold text-slate-900">{office.cash_balance.toFixed(2)} €</p>
            </div>
            <div className="rounded-xl bg-slate-50 py-2">
              <p className="text-[11px] uppercase text-slate-400">💳 Tarjeta</p>
              <p className="font-semibold text-slate-900">{office.card_balance.toFixed(2)} €</p>
            </div>
            <div className="rounded-xl bg-charge-50 py-2">
              <p className="text-[11px] uppercase text-charge-700">Total</p>
              <p className="font-semibold text-charge-700">{(office.cash_balance + office.card_balance).toFixed(2)} €</p>
            </div>
          </div>
          {office.last_reset_at && (
            <p className="mt-2 text-xs text-slate-400">
              Último reinicio: {new Date(office.last_reset_at).toLocaleString('es-ES')}
            </p>
          )}
        </div>
      )}

      <div className="mt-6 space-y-4">
        {loading && <p className="text-sm text-slate-400">Cargando…</p>}
        {pageItems.map((r) => {
          const totalWallet = r.wallet.cash_balance + r.wallet.card_balance;
          return (
            <div key={r.driver.id} className="card">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="font-semibold text-slate-900">
                    {r.driver.full_name}
                    {!r.driver.active && (
                      <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-600">Inactivo</span>
                    )}
                  </p>
                  {(r.driver.vehicle_plate || r.driver.zone) && (
                    <p className="text-xs text-slate-400">
                      {r.driver.vehicle_plate} {r.driver.zone ? `· ${r.driver.zone}` : ''}
                    </p>
                  )}
                </div>
                <button className="btn-secondary" onClick={() => setTarget(r)} disabled={totalWallet === 0}>
                  Reiniciar caja
                </button>
              </div>

              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-xl bg-slate-50 py-2">
                  <p className="text-[11px] uppercase text-slate-400">💵 Efectivo</p>
                  <p className="font-semibold text-slate-900">{r.wallet.cash_balance.toFixed(2)} €</p>
                </div>
                <div className="rounded-xl bg-slate-50 py-2">
                  <p className="text-[11px] uppercase text-slate-400">💳 Tarjeta</p>
                  <p className="font-semibold text-slate-900">{r.wallet.card_balance.toFixed(2)} €</p>
                </div>
                <div className="rounded-xl bg-charge-50 py-2">
                  <p className="text-[11px] uppercase text-charge-700">Total</p>
                  <p className="font-semibold text-charge-700">{totalWallet.toFixed(2)} €</p>
                </div>
              </div>

              {r.wallet.last_reset_at && (
                <p className="mt-2 text-xs text-slate-400">
                  Último reinicio: {new Date(r.wallet.last_reset_at).toLocaleString('es-ES')}
                </p>
              )}

              <div className="mt-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Stock que lleva</p>
                {r.stock.length === 0 ? (
                  <p className="mt-1 text-sm text-slate-400">Sin stock asignado.</p>
                ) : (
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    {r.stock.map((s, i) => (
                      <button
                        key={i}
                        onClick={() => openReclaim(r.driver, s)}
                        className="group flex items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1 text-xs text-slate-700 hover:bg-red-50 hover:text-red-700"
                        title="Retirar este stock y devolverlo al almacén"
                      >
                        {s.product_model?.brand} {s.product_model?.model_name}: <strong>{s.quantity}</strong>
                        {s.product_model?.product_ean_codes?.[0] && (
                          <span className="text-slate-400 group-hover:text-red-400"> · {s.product_model.product_ean_codes[0].ean_code}</span>
                        )}
                        <span className="text-slate-300 group-hover:text-red-400">✕</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {!loading && rows.length === 0 && (
          <div className="card text-center text-slate-400">Todavía no hay conductores dados de alta.</div>
        )}
        {!loading && rows.length > 0 && filtered.length === 0 && (
          <div className="card text-center text-slate-400">Ningún conductor coincide con la búsqueda.</div>
        )}
      </div>

      <Pagination page={page} pageSize={10} total={total} onPageChange={setPage} />

      <ConfirmModal
        open={officeResetOpen}
        title="Reiniciar caja de oficina"
        description={`La caja de oficina (${((office?.cash_balance ?? 0) + (office?.card_balance ?? 0)).toFixed(2)} €) se pondrá a 0. Esta acción queda registrada.`}
        confirmLabel="Sí, reiniciar"
        tone="danger"
        loading={submitting}
        onConfirm={confirmOfficeReset}
        onCancel={() => setOfficeResetOpen(false)}
      />

      <ConfirmModal
        open={!!target}
        title="Reiniciar caja"
        description={`La caja de ${target?.driver.full_name} (${((target?.wallet.cash_balance ?? 0) + (target?.wallet.card_balance ?? 0)).toFixed(2)} €) se pondrá a 0. Esta acción queda registrada.`}
        confirmLabel="Sí, reiniciar"
        tone="danger"
        loading={submitting}
        onConfirm={confirmReset}
        onCancel={() => setTarget(null)}
      />

      {reclaimTarget && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full sm:max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-slate-900">Retirar stock</h2>
            <p className="mt-1 text-sm text-slate-500">
              {reclaimTarget.stock.product_model?.brand} {reclaimTarget.stock.product_model?.model_name} — de{' '}
              {reclaimTarget.driver.full_name}
            </p>
            <div className="mt-4">
              <label className="label-field">Cantidad a retirar (disponible: {reclaimTarget.stock.quantity})</label>
              <QuantityInput
                value={reclaimQty}
                onChange={setReclaimQty}
                max={reclaimTarget.stock.quantity}
                className="input-field text-lg font-semibold"
              />
            </div>
            <div className="mt-6 flex gap-3">
              <button className="btn-secondary flex-1" onClick={() => setReclaimTarget(null)}>Cancelar</button>
              <button
                className="rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 flex-1"
                onClick={() => {
                  if (reclaimQty <= 0) {
                    toast.error('Indica una cantidad mayor que 0.');
                    return;
                  }
                  setReclaimConfirmOpen(true);
                }}
              >
                Retirar
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        open={reclaimConfirmOpen}
        title="Confirmar retirada de stock"
        description={`Vas a quitarle ${reclaimQty} unidad(es) de ${reclaimTarget?.stock.product_model?.brand} ${reclaimTarget?.stock.product_model?.model_name} a ${reclaimTarget?.driver.full_name} y devolverlas al almacén central.`}
        confirmLabel="Sí, retirar"
        tone="danger"
        loading={submitting}
        onConfirm={confirmReclaim}
        onCancel={() => setReclaimConfirmOpen(false)}
      />
    </div>
  );
}
