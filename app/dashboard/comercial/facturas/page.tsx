'use client';

import { useEffect, useState } from 'react';
import ConfirmModal from '@/components/ConfirmModal';
import Pagination from '@/components/Pagination';
import { usePagination } from '@/hooks/usePagination';
import toast from 'react-hot-toast';

interface InvoiceItem {
  id: string;
  description: string;
  quantity: number;
  unit_price: number | null;
  line_total: number | null;
}
interface Invoice {
  id: string;
  invoice_number: string;
  status: string;
  total: number;
  point_of_sale: { name: string } | null;
  invoice_items: InvoiceItem[];
  created_at: string;
}

export default function FacturasPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Invoice | null>(null);
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    setLoading(true);
    const res = await fetch('/api/invoices');
    const json = await res.json();
    setInvoices(json.invoices ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  function openEditor(inv: Invoice) {
    setEditing(inv);
    const initial: Record<string, string> = {};
    inv.invoice_items.forEach((it) => {
      initial[it.id] = it.unit_price?.toString() ?? '';
    });
    setPrices(initial);
  }

  async function submitPrices() {
    if (!editing) return;
    const items = editing.invoice_items.map((it) => ({
      id: it.id,
      unit_price: Number(prices[it.id] || 0),
    }));
    setSubmitting(true);
    const res = await fetch(`/api/invoices/${editing.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items, status: 'issued' }),
    });
    setSubmitting(false);
    setConfirmOpen(false);
    if (!res.ok) {
      toast.error('Error al guardar la factura.');
      return;
    }
    toast.success('Factura emitida con los precios indicados.');
    setEditing(null);
    load();
  }

  const [search, setSearch] = useState('');
  const filtered = invoices.filter((inv) =>
    `${inv.invoice_number} ${inv.point_of_sale?.name ?? ''}`.toLowerCase().includes(search.toLowerCase())
  );
  const { page, setPage, pageItems, total } = usePagination(filtered, 10);

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold text-slate-900">Facturas</h1>
      <p className="mt-1 text-sm text-slate-500">
        Se generan en borrador con los precios en blanco. Complétalos aquí para emitirlas.
      </p>

      <input
        className="input-field mt-6"
        placeholder="Buscar por número de factura o cliente…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <div className="mt-4 space-y-3">
        {loading && <p className="text-sm text-slate-400">Cargando…</p>}
        {pageItems.map((inv) => (
          <div key={inv.id} className="card">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-semibold text-slate-900">{inv.invoice_number}</p>
                <p className="text-sm text-slate-500">{inv.point_of_sale?.name}</p>
                <p className="text-xs text-slate-400">{new Date(inv.created_at).toLocaleString('es-ES')}</p>
              </div>
              <div className="text-right">
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                  inv.status === 'draft' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
                }`}>
                  {inv.status === 'draft' ? 'Borrador (precios pendientes)' : 'Emitida'}
                </span>
                <p className="mt-1 font-bold text-slate-900">{inv.total.toFixed(2)} €</p>
              </div>
            </div>
            <button className="btn-secondary mt-3" onClick={() => openEditor(inv)}>
              {inv.status === 'draft' ? 'Rellenar precios' : 'Ver / editar'}
            </button>
          </div>
        ))}
        {!loading && invoices.length === 0 && (
          <div className="card text-center text-slate-400">Todavía no hay facturas.</div>
        )}
        {!loading && invoices.length > 0 && filtered.length === 0 && (
          <div className="card text-center text-slate-400">Ninguna factura coincide con la búsqueda.</div>
        )}
      </div>

      <Pagination page={page} pageSize={10} total={total} onPageChange={setPage} />

      {editing && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full sm:max-w-lg rounded-2xl bg-white p-6 shadow-xl max-h-[85vh] overflow-y-auto">
            <h2 className="text-lg font-semibold text-slate-900">{editing.invoice_number}</h2>
            <div className="mt-4 space-y-3">
              {editing.invoice_items.map((it) => (
                <div key={it.id} className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-slate-800">{it.description}</p>
                    <p className="text-xs text-slate-400">Cantidad: {it.quantity}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      placeholder="Precio ud."
                      className="input-field w-28"
                      value={prices[it.id] ?? ''}
                      onChange={(e) => setPrices((p) => ({ ...p, [it.id]: e.target.value }))}
                    />
                    <span className="text-sm text-slate-400">€</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-6 flex gap-3">
              <button className="btn-secondary flex-1" onClick={() => setEditing(null)}>Cerrar</button>
              <button className="btn-charge flex-1" onClick={() => setConfirmOpen(true)}>Emitir factura</button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        open={confirmOpen}
        title="Emitir factura"
        description="Se calcularán los totales con los precios indicados y la factura pasará a 'Emitida'."
        confirmLabel="Emitir"
        loading={submitting}
        onConfirm={submitPrices}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
