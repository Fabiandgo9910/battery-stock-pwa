'use client';

import { useEffect, useState } from 'react';
import ConfirmModal from '@/components/ConfirmModal';
import toast from 'react-hot-toast';

interface StockRow {
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

export default function BilleterasAdminPage() {
  const [rows, setRows] = useState<DriverRow[]>([]);
  const [target, setTarget] = useState<DriverRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [searchDriver, setSearchDriver] = useState('');
  const [searchBattery, setSearchBattery] = useState('');

  async function load() {
    setLoading(true);
    const res = await fetch('/api/admin/driver-overview');
    const json = await res.json();
    setRows(json.drivers ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

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

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold text-slate-900">Conductores: caja y stock</h1>
      <p className="mt-1 text-sm text-slate-500">
        Consulta lo que lleva cada conductor y su caja acumulada. Reinicia la caja individualmente
        cuando el conductor te haya entregado el dinero recaudado.
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

      <div className="mt-6 space-y-4">
        {loading && <p className="text-sm text-slate-400">Cargando…</p>}
        {rows
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
          })
          .map((r) => {
          const total = r.wallet.cash_balance + r.wallet.card_balance;
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
                <button className="btn-secondary" onClick={() => setTarget(r)} disabled={total === 0}>
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
                  <p className="font-semibold text-charge-700">{total.toFixed(2)} €</p>
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
                      <span key={i} className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs text-slate-700">
                        {s.product_model?.brand} {s.product_model?.model_name}: <strong>{s.quantity}</strong>
                        {s.product_model?.product_ean_codes?.[0] && (
                          <span className="text-slate-400"> · {s.product_model.product_ean_codes[0].ean_code}</span>
                        )}
                      </span>
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
      </div>

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
    </div>
  );
}
