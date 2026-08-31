'use client';

import { useEffect, useState, useCallback } from 'react';
import Pagination from '@/components/Pagination';
import { usePagination } from '@/hooks/usePagination';

interface Row {
  seller_id: string;
  seller_name: string;
  sale_channel: string;
  units_sold: number;
  units_cash: number;
  units_card: number;
  cash_total: number;
  card_total: number;
  sales_count: number;
  old_batteries_collected: number;
}

function todayISO() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

function isToday(dateStr: string) {
  return dateStr === todayISO();
}

// Calcula el rango [inicio del día, fin] en la ZONA HORARIA LOCAL del
// navegador. Si el día elegido es HOY, el final es "ahora mismo" (para que
// las ventas aparezcan al instante, no haya que esperar a que acabe el día).
// Si es un día pasado, el final es el final de ese día completo.
function computeRange(dateStr: string) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const start = new Date(y, m - 1, d, 0, 0, 0, 0);
  const end = isToday(dateStr) ? new Date() : new Date(y, m - 1, d, 23, 59, 59, 999);
  return { start: start.toISOString(), end: end.toISOString() };
}

export default function VentasDiariasPage() {
  const [date, setDate] = useState(todayISO());
  const [rows, setRows] = useState<Row[]>([]);
  const [search, setSearch] = useState('');
  const [totals, setTotals] = useState({ units_sold: 0, units_cash: 0, units_card: 0, cash_total: 0, card_total: 0, old_batteries_collected: 0 });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { start, end } = computeRange(date);
    const res = await fetch(`/api/admin/daily-sales?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`);
    const json = await res.json();
    setRows(json.rows ?? []);
    setTotals(json.totals ?? { units_sold: 0, units_cash: 0, units_card: 0, cash_total: 0, card_total: 0, old_batteries_collected: 0 });
    setLoading(false);
  }, [date]);

  useEffect(() => {
    load();
    // Si estamos viendo "hoy", refrescamos cada 30s para que se note que va "hasta el momento".
    if (!isToday(date)) return;
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, [date, load]);

  const filtered = rows.filter((r) => r.seller_name.toLowerCase().includes(search.toLowerCase()));
  const { page, setPage, pageItems, total } = usePagination(filtered, 15);

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold text-slate-900">Ventas del día</h1>
      <p className="mt-1 text-sm text-slate-500">
        Baterías vendidas por conductores y venta directa de almacén, hasta este mismo momento si es hoy.
      </p>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <input
          type="date"
          className="input-field sm:max-w-xs"
          value={date}
          max={todayISO()}
          onChange={(e) => setDate(e.target.value)}
        />
        <input
          className="input-field"
          placeholder="Buscar conductor o vendedor…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button
          className="btn-charge whitespace-nowrap"
          onClick={() => window.open(`/api/exports/caja-conductores?from=${date}&to=${date}`, '_blank')}
        >
          Exportar caja conductores
        </button>
      </div>

      {isToday(date) && (
        <p className="mt-2 text-xs text-slate-400">Mostrando hasta ahora mismo · se actualiza cada 30s</p>
      )}

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-6">
        <div className="card text-center">
          <p className="text-xs uppercase text-slate-400">Uds. vendidas</p>
          <p className="mt-1 text-xl font-bold text-slate-900">{totals.units_sold}</p>
        </div>
        <div className="card text-center">
          <p className="text-xs uppercase text-slate-400">💵 Uds. efectivo</p>
          <p className="mt-1 text-xl font-bold text-slate-900">{totals.units_cash}</p>
        </div>
        <div className="card text-center">
          <p className="text-xs uppercase text-slate-400">💳 Uds. tarjeta</p>
          <p className="mt-1 text-xl font-bold text-slate-900">{totals.units_card}</p>
        </div>
        <div className="card text-center">
          <p className="text-xs uppercase text-slate-400">💵 Efectivo</p>
          <p className="mt-1 text-xl font-bold text-slate-900">{totals.cash_total.toFixed(2)} €</p>
        </div>
        <div className="card text-center">
          <p className="text-xs uppercase text-slate-400">💳 Tarjeta</p>
          <p className="mt-1 text-xl font-bold text-slate-900">{totals.card_total.toFixed(2)} €</p>
        </div>
        <div className="card text-center">
          <p className="text-xs uppercase text-slate-400">🔋 Baterías viejas</p>
          <p className="mt-1 text-xl font-bold text-slate-900">{totals.old_batteries_collected}</p>
        </div>
      </div>

      <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Vendedor</th>
              <th className="px-4 py-3">Canal</th>
              <th className="px-4 py-3">Uds. (💵 / 💳)</th>
              <th className="px-4 py-3">💵 Efectivo</th>
              <th className="px-4 py-3">💳 Tarjeta</th>
              <th className="px-4 py-3">Total</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-400">Cargando…</td></tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-400">Sin ventas para ese filtro.</td></tr>
            )}
            {pageItems.map((r) => (
              <tr key={r.seller_id} className="border-t border-slate-100">
                <td className="px-4 py-3 font-medium text-slate-900">{r.seller_name}</td>
                <td className="px-4 py-3 text-slate-500">
                  {r.sale_channel === 'warehouse_direct' ? 'Almacén (directa)' : 'Conductor'}
                </td>
                <td className="px-4 py-3 text-slate-600">{r.units_sold} ({r.units_cash} / {r.units_card})</td>
                <td className="px-4 py-3 text-slate-600">{r.cash_total.toFixed(2)} €</td>
                <td className="px-4 py-3 text-slate-600">{r.card_total.toFixed(2)} €</td>
                <td className="px-4 py-3 font-semibold text-slate-900">{(r.cash_total + r.card_total).toFixed(2)} €</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pagination page={page} pageSize={15} total={total} onPageChange={setPage} />
    </div>
  );
}
