'use client';

import { useEffect, useState } from 'react';
import { createBrowserClient } from '@/lib/supabaseClient';
import { useProfile } from '@/hooks/useProfile';
import Pagination from '@/components/Pagination';
import { usePagination } from '@/hooks/usePagination';
import type { DriverWallet } from '@/types/domain';

interface TxRow {
  id: string;
  amount: number;
  method: string;
  type: string;
  created_at: string;
}

export default function BilleteraPage() {
  const supabase = createBrowserClient();
  const { profile } = useProfile();
  const [wallet, setWallet] = useState<DriverWallet | null>(null);
  const [txs, setTxs] = useState<TxRow[]>([]);

  useEffect(() => {
    async function load() {
      if (!profile) return;
      const { data: w } = await supabase.from('driver_wallets').select('*').eq('driver_id', profile.id).maybeSingle();
      setWallet(w);
      const { data: t } = await supabase
        .from('driver_wallet_transactions')
        .select('*')
        .eq('driver_id', profile.id)
        .order('created_at', { ascending: false })
        .limit(200);
      setTxs(t ?? []);
    }
    load();
  }, [profile, supabase]);

  const total = (wallet?.cash_balance ?? 0) + (wallet?.card_balance ?? 0);
  const { page, setPage, pageItems, total: totalTx } = usePagination(txs, 15);

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="text-2xl font-semibold text-slate-900">Mi caja</h1>
      <p className="mt-1 text-sm text-slate-500">Dinero acumulado desde tu último reinicio de caja.</p>

      <div className="mt-6 grid grid-cols-2 gap-3">
        <div className="card">
          <p className="text-xs uppercase tracking-wide text-slate-500">💵 Efectivo</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{(wallet?.cash_balance ?? 0).toFixed(2)} €</p>
        </div>
        <div className="card">
          <p className="text-xs uppercase tracking-wide text-slate-500">💳 Tarjeta</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{(wallet?.card_balance ?? 0).toFixed(2)} €</p>
        </div>
      </div>

      <div className="card mt-3 bg-slate-900 text-center">
        <p className="text-xs uppercase tracking-wide text-slate-400">Total en caja</p>
        <p className="mt-1 text-3xl font-bold text-charge-400">{total.toFixed(2)} €</p>
      </div>

      {wallet?.last_reset_at && (
        <p className="mt-3 text-center text-xs text-slate-400">
          Último reinicio: {new Date(wallet.last_reset_at).toLocaleString('es-ES')}
        </p>
      )}

      <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-slate-500">Movimientos recientes</h2>
      <div className="mt-3 space-y-2">
        {pageItems.map((tx) => (
          <div key={tx.id} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm">
            <div>
              <p className="font-medium text-slate-800">
                {tx.type === 'reset' ? 'Reinicio de caja' : tx.method === 'cash' ? 'Venta en efectivo' : 'Venta con tarjeta'}
              </p>
              <p className="text-xs text-slate-400">{new Date(tx.created_at).toLocaleString('es-ES')}</p>
            </div>
            <p className={`font-semibold ${tx.amount < 0 ? 'text-red-600' : 'text-slate-900'}`}>
              {tx.amount > 0 ? '+' : ''}{tx.amount.toFixed(2)} €
            </p>
          </div>
        ))}
        {txs.length === 0 && <p className="text-sm text-slate-400">Sin movimientos todavía.</p>}
      </div>

      <Pagination page={page} pageSize={15} total={totalTx} onPageChange={setPage} />
    </div>
  );
}
