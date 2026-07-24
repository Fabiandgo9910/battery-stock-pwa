'use client';

import { useEffect, useState } from 'react';
import { createBrowserClient } from '@/lib/supabaseClient';
import ConfirmModal from '@/components/ConfirmModal';
import toast from 'react-hot-toast';

interface Row {
  driver_id: string;
  cash_balance: number;
  card_balance: number;
  last_reset_at: string | null;
  profile: { full_name: string };
}

export default function BilleterasAdminPage() {
  const supabase = createBrowserClient();
  const [rows, setRows] = useState<Row[]>([]);
  const [targetDriver, setTargetDriver] = useState<Row | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from('driver_wallets')
      .select('driver_id, cash_balance, card_balance, last_reset_at, profile:profiles(full_name)')
      .order('cash_balance', { ascending: false });
    setRows((data as any) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function confirmReset() {
    if (!targetDriver) return;
    setSubmitting(true);
    const res = await fetch('/api/wallet-reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ driver_id: targetDriver.driver_id }),
    });
    setSubmitting(false);
    setTargetDriver(null);
    if (!res.ok) {
      toast.error('No se pudo reiniciar la caja.');
      return;
    }
    toast.success('Caja reiniciada correctamente.');
    load();
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold text-slate-900">Cajas de conductores</h1>
      <p className="mt-1 text-sm text-slate-500">
        Reinicia la caja de un conductor cuando haya entregado el dinero recaudado.
      </p>

      <div className="mt-6 space-y-3">
        {loading && <p className="text-sm text-slate-400">Cargando…</p>}
        {rows.map((r) => (
          <div key={r.driver_id} className="card flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="font-semibold text-slate-900">{r.profile?.full_name}</p>
              <p className="text-sm text-slate-500">
                💵 {r.cash_balance.toFixed(2)} € &nbsp;·&nbsp; 💳 {r.card_balance.toFixed(2)} € &nbsp;·&nbsp;
                Total {(r.cash_balance + r.card_balance).toFixed(2)} €
              </p>
              {r.last_reset_at && (
                <p className="text-xs text-slate-400">
                  Último reinicio: {new Date(r.last_reset_at).toLocaleString('es-ES')}
                </p>
              )}
            </div>
            <button className="btn-secondary" onClick={() => setTargetDriver(r)}>
              Reiniciar caja
            </button>
          </div>
        ))}
      </div>

      <ConfirmModal
        open={!!targetDriver}
        title="Reiniciar caja"
        description={`La caja de ${targetDriver?.profile?.full_name} (${((targetDriver?.cash_balance ?? 0) + (targetDriver?.card_balance ?? 0)).toFixed(2)} €) se pondrá a 0. Esta acción queda registrada.`}
        confirmLabel="Sí, reiniciar"
        tone="danger"
        loading={submitting}
        onConfirm={confirmReset}
        onCancel={() => setTargetDriver(null)}
      />
    </div>
  );
}
