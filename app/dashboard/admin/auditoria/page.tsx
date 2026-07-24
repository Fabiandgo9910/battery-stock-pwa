'use client';

import { useEffect, useState } from 'react';

interface LogRow {
  id: string;
  action: string;
  table_name: string;
  record_id: string | null;
  created_at: string;
  user: { full_name: string } | null;
}

const ACTION_LABEL: Record<string, string> = {
  INSERT: 'Creó',
  UPDATE: 'Modificó',
  DELETE: 'Eliminó',
};

const TABLE_LABEL: Record<string, string> = {
  product_models: 'un modelo de producto',
  warehouse_stock: 'stock de almacén',
  driver_stock: 'stock de un conductor',
  pos_stock: 'stock de una venta comercial',
  sales: 'una venta',
  driver_wallets: 'una caja de conductor',
  invoices: 'una factura',
  points_of_sale: 'una venta comercial',
  profiles: 'un usuario',
};

export default function AuditoriaPage() {
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [table, setTable] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const res = await fetch(`/api/audit${table ? `?table=${table}` : ''}`);
      const json = await res.json();
      setLogs(json.logs ?? []);
      setLoading(false);
    }
    load();
  }, [table]);

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold text-slate-900">Auditoría</h1>
      <p className="mt-1 text-sm text-slate-500">Trazabilidad de todas las acciones sensibles del sistema.</p>

      <select className="input-field mt-6" value={table} onChange={(e) => setTable(e.target.value)}>
        <option value="">Todas las tablas</option>
        {Object.entries(TABLE_LABEL).map(([k, v]) => (
          <option key={k} value={k}>{v}</option>
        ))}
      </select>

      <div className="mt-4 space-y-2">
        {loading && <p className="text-sm text-slate-400">Cargando…</p>}
        {logs.map((log) => (
          <div key={log.id} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm">
            <div>
              <p className="text-slate-800">
                <strong>{log.user?.full_name ?? 'Sistema'}</strong> {ACTION_LABEL[log.action]?.toLowerCase()}{' '}
                {TABLE_LABEL[log.table_name] ?? log.table_name}
              </p>
              <p className="text-xs text-slate-400">{new Date(log.created_at).toLocaleString('es-ES')}</p>
            </div>
          </div>
        ))}
        {!loading && logs.length === 0 && <p className="text-sm text-slate-400">Sin registros.</p>}
      </div>
    </div>
  );
}
