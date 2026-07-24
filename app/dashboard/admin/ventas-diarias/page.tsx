'use client';

import { useEffect, useState } from 'react';

interface Row {
  driver_id: string;
  driver_name: string;
  units_sold: number;
  cash_total: number;
  card_total: number;
  sales_count: number;
}

function todayISO() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

export default function VentasDiariasPage() {
  const [date, setDate] = useState(todayISO());
  const [rows, setRows] = useState<Row[]>([]);
  const [totals, setTotals] = useState({ units_sold: 0, cash_total: 0, card_total: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const res = await fetch(`/api/admin/daily-sales?date=${date}`);
      const json = await res.json();
      setRows(json.rows ?? []);
      setTotals(json.totals ?? { units_sold: 0, cash_total: 0, card_total: 0 });
      setLoading(false);
    }
    load();
  }, [date]);

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold text-slate-900">Ventas del día por conductor</h1>
      <p className="mt-1 text-sm text-slate-500">Baterías vendidas y dinero cobrado, separado por efectivo y tarjeta.</p>

      <input
        type="date"
        className="input-field mt-6 max-w-xs"
        value={date}
        onChange={(e) => setDate(e.target.value)}
      />

      <div className="mt-4 grid grid-cols-3 gap-3">
        <div className="card text-center">
          <p className="text-xs uppercase text-slate-400">Baterías vendidas</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{totals.units_sold}</p>
        </div>
        <div className="card text-center">
          <p className="text-xs uppercase text-slate-400">💵 Efectivo</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{totals.cash_total.toFixed(2)} €</p>
        </div>
        <div className="card text-center">
          <p className="text-xs uppercase text-slate-400">💳 Tarjeta</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{totals.card_total.toFixed(2)} €</p>
        </div>
      </div>

      <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Conductor</th>
              <th className="px-4 py-3">Uds. vendidas</th>
              <th className="px-4 py-3">💵 Efectivo</th>
              <th className="px-4 py-3">💳 Tarjeta</th>
              <th className="px-4 py-3">Total</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-400">Cargando…</td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-400">Sin ventas ese día.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.driver_id} className="border-t border-slate-100">
                <td className="px-4 py-3 font-medium text-slate-900">{r.driver_name}</td>
                <td className="px-4 py-3 text-slate-600">{r.units_sold}</td>
                <td className="px-4 py-3 text-slate-600">{r.cash_total.toFixed(2)} €</td>
                <td className="px-4 py-3 text-slate-600">{r.card_total.toFixed(2)} €</td>
                <td className="px-4 py-3 font-semibold text-slate-900">{(r.cash_total + r.card_total).toFixed(2)} €</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
