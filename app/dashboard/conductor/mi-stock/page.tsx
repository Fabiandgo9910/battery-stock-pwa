'use client';

import { useEffect, useState } from 'react';
import { createBrowserClient } from '@/lib/supabaseClient';
import { useProfile } from '@/hooks/useProfile';
import Pagination from '@/components/Pagination';
import { usePagination } from '@/hooks/usePagination';
import type { DriverStockRow } from '@/types/domain';

export default function MiStockPage() {
  const supabase = createBrowserClient();
  const { profile } = useProfile();
  const [stock, setStock] = useState<DriverStockRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    async function load() {
      if (!profile) return;
      const { data } = await supabase
        .from('driver_stock')
        .select('*, product_model:product_models(*)')
        .eq('driver_id', profile.id)
        .gt('quantity', 0)
        .order('quantity', { ascending: false });
      setStock((data as any) ?? []);
      setLoading(false);
    }
    load();
  }, [profile, supabase]);

  const filtered = stock.filter((row) =>
    `${row.product_model?.brand ?? ''} ${row.product_model?.model_name ?? ''}`.toLowerCase().includes(search.toLowerCase())
  );
  const { page, setPage, pageItems, total } = usePagination(filtered, 15);

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-semibold text-slate-900">Mi stock</h1>
      <p className="mt-1 text-sm text-slate-500">Baterías que llevas actualmente en tu furgoneta.</p>

      {stock.length > 5 && (
        <input
          className="input-field mt-6"
          placeholder="Buscar por marca o modelo…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      )}

      <div className="mt-6 space-y-3">
        {loading && <p className="text-sm text-slate-400">Cargando…</p>}
        {!loading && stock.length === 0 && (
          <div className="card text-center text-slate-400">No tienes stock asignado todavía.</div>
        )}
        {!loading && stock.length > 0 && filtered.length === 0 && (
          <div className="card text-center text-slate-400">Ninguna batería coincide con la búsqueda.</div>
        )}
        {pageItems.map((row) => (
          <div key={row.id} className="card flex items-center justify-between">
            <div>
              <p className="font-semibold text-slate-900">
                {row.product_model?.brand} {row.product_model?.model_name}
              </p>
              <p className="text-sm text-slate-500">
                {row.product_model?.amperage_ah ? `${row.product_model.amperage_ah} Ah` : ''}
                {row.product_model?.battery_tech ? ` · ${row.product_model.battery_tech.toUpperCase()}` : ''}
              </p>
            </div>
            <div className="rounded-xl bg-charge-100 px-3 py-1.5 text-lg font-bold text-charge-700">
              {row.quantity}
            </div>
          </div>
        ))}
      </div>

      <Pagination page={page} pageSize={15} total={total} onPageChange={setPage} />
    </div>
  );
}
