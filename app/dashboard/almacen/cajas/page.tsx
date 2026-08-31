'use client';

import { useState } from 'react';
import toast from 'react-hot-toast';
import { createBrowserClient } from '@/lib/supabaseClient';

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

interface PreviewCondRow {
  seller: string;
  battery: string;
  code: string;
  total: number;
  payment: string;
  plate: string;
}
interface PreviewComRow {
  model: string;
  quantity: number;
  company: string;
  date: string;
}

export default function CajasExportPage() {
  const supabase = createBrowserClient();
  const [from, setFrom] = useState(todayStr());
  const [to, setTo] = useState(todayStr());
  const [downloading, setDownloading] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [condRows, setCondRows] = useState<PreviewCondRow[] | null>(null);
  const [comRows, setComRows] = useState<PreviewComRow[] | null>(null);

  async function downloadExcel() {
    setDownloading(true);
    try {
      const res = await fetch(`/api/exports/cajas?from=${from}&to=${to}`);
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        toast.error(json.error || 'Error al generar el Excel');
        return;
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cajas_${from}_a_${to}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  }

  async function loadPreviewAndPrint() {
    setLoadingPreview(true);
    try {
      const fromDate = new Date(from);
      fromDate.setHours(0, 0, 0, 0);
      const toDate = new Date(to);
      toDate.setHours(23, 59, 59, 999);

      const { data: sales } = await supabase
        .from('sales')
        .select(
          `total_amount, payment_method, customer_vehicle_plate, sold_at,
           seller:profiles(full_name),
           sale_items(quantity, product_model:product_models(brand, model_name), battery_unit:battery_units(code))`
        )
        .eq('sale_channel', 'driver')
        .gte('sold_at', fromDate.toISOString())
        .lte('sold_at', toDate.toISOString())
        .order('sold_at');

      const cRows: PreviewCondRow[] = [];
      for (const s of sales ?? []) {
        const seller = (s as any).seller?.full_name ?? '';
        for (const item of (s as any).sale_items ?? []) {
          cRows.push({
            seller,
            battery: item.product_model ? `${item.product_model.brand} ${item.product_model.model_name}` : '',
            code: item.battery_unit?.code ?? '',
            total: Number(s.total_amount ?? 0),
            payment: s.payment_method,
            plate: s.customer_vehicle_plate ?? '',
          });
        }
      }
      setCondRows(cRows);

      const { data: orders } = await supabase
        .from('commercial_orders')
        .select('dispatched_at, point_of_sale:points_of_sale(name), commercial_order_items(quantity, product_model:product_models(brand, model_name))')
        .eq('status', 'dispatched')
        .gte('dispatched_at', fromDate.toISOString())
        .lte('dispatched_at', toDate.toISOString())
        .order('dispatched_at');

      const oRows: PreviewComRow[] = [];
      for (const o of orders ?? []) {
        const company = (o as any).point_of_sale?.name ?? '';
        const date = o.dispatched_at ? new Date(o.dispatched_at).toLocaleDateString('es-ES') : '';
        for (const item of (o as any).commercial_order_items ?? []) {
          oRows.push({
            model: item.product_model ? `${item.product_model.brand} ${item.product_model.model_name}` : '',
            quantity: item.quantity ?? 0,
            company,
            date,
          });
        }
      }
      setComRows(oRows);

      setTimeout(() => window.print(), 200);
    } finally {
      setLoadingPreview(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-semibold text-slate-900">Cajas: conductores y comercial</h1>
      <p className="mt-1 text-sm text-slate-500">
        Exporta un Excel con el mismo diseño de las hojas de caja de conductores y caja comercial,
        filtrado por fecha. También puedes imprimir un resumen directamente.
      </p>

      <div className="card mt-6 print:hidden">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label-field">Desde</label>
            <input type="date" className="input-field" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="label-field">Hasta</label>
            <input type="date" className="input-field" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
        <div className="mt-4 flex gap-3">
          <button className="btn-secondary flex-1" disabled={loadingPreview} onClick={loadPreviewAndPrint}>
            {loadingPreview ? 'Preparando…' : 'Imprimir'}
          </button>
          <button className="btn-charge flex-1" disabled={downloading} onClick={downloadExcel}>
            {downloading ? 'Generando…' : 'Descargar Excel'}
          </button>
        </div>
      </div>

      {(condRows || comRows) && (
        <div id="printable-report" className="mt-8 space-y-8">
          <div>
            <h2 className="text-lg font-bold">CAJA CONDUCTORES ({from} a {to})</h2>
            <table className="mt-2 w-full border-collapse text-xs">
              <thead>
                <tr className="bg-slate-100">
                  {['CHOFER', 'BATERIA', 'Nº BATERIA', 'MATRICULA', 'IMPORTE', 'EFECT/TARJE'].map((h) => (
                    <th key={h} className="border border-slate-300 px-2 py-1 text-left">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(condRows ?? []).map((r, i) => (
                  <tr key={i}>
                    <td className="border border-slate-300 px-2 py-1">{r.seller}</td>
                    <td className="border border-slate-300 px-2 py-1">{r.battery}</td>
                    <td className="border border-slate-300 px-2 py-1 font-mono">{r.code}</td>
                    <td className="border border-slate-300 px-2 py-1">{r.plate}</td>
                    <td className="border border-slate-300 px-2 py-1 text-right">{r.total.toFixed(2)} €</td>
                    <td className="border border-slate-300 px-2 py-1">{r.payment}</td>
                  </tr>
                ))}
                {(condRows ?? []).length === 0 && (
                  <tr><td colSpan={6} className="border border-slate-300 px-2 py-2 text-center text-slate-400">Sin ventas en este rango.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div>
            <h2 className="text-lg font-bold">CAJA COMERCIAL ({from} a {to})</h2>
            <table className="mt-2 w-full border-collapse text-xs">
              <thead>
                <tr className="bg-slate-100">
                  {['MODELO BATERIA', 'CANTIDAD', 'EMPRESA', 'FECHA ENTREGA'].map((h) => (
                    <th key={h} className="border border-slate-300 px-2 py-1 text-left">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(comRows ?? []).map((r, i) => (
                  <tr key={i}>
                    <td className="border border-slate-300 px-2 py-1">{r.model}</td>
                    <td className="border border-slate-300 px-2 py-1 text-center">{r.quantity}</td>
                    <td className="border border-slate-300 px-2 py-1">{r.company}</td>
                    <td className="border border-slate-300 px-2 py-1">{r.date}</td>
                  </tr>
                ))}
                {(comRows ?? []).length === 0 && (
                  <tr><td colSpan={4} className="border border-slate-300 px-2 py-2 text-center text-slate-400">Sin salidas comerciales en este rango.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
