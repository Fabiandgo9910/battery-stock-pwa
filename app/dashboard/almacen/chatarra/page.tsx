'use client';

import { useEffect, useState } from 'react';
import Pagination from '@/components/Pagination';
import { useServerPagination, type ServerPageResult } from '@/hooks/useServerPagination';
import { createBrowserClient } from '@/lib/supabaseClient';
import toast from 'react-hot-toast';

interface PosOption {
  id: string;
  name: string;
}
interface ScrapRow {
  id: string;
  quantity: number;
  weight_kg: number | null;
  notes: string | null;
  created_at: string;
  point_of_sale: { name: string } | null;
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export default function ChatarraPage() {
  const supabase = createBrowserClient();
  const [pointsOfSale, setPointsOfSale] = useState<PosOption[]>([]);
  const [posId, setPosId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [weight, setWeight] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [exportFrom, setExportFrom] = useState(todayStr());
  const [exportTo, setExportTo] = useState(todayStr());

  async function fetchPage(
    { page, pageSize }: { page: number; pageSize: number; search: string },
    signal: AbortSignal
  ): Promise<ServerPageResult<ScrapRow>> {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    const res = await fetch(`/api/scrap-deliveries?${params.toString()}`, { signal });
    const json = await res.json();
    return { items: json.scrap_deliveries ?? [], total: json.total ?? 0 };
  }

  const { page, setPage, items, total, loading, reload } = useServerPagination(fetchPage, { pageSize: 10 });

  useEffect(() => {
    async function loadPos() {
      const { data } = await supabase.from('points_of_sale').select('id, name').eq('active', true).order('name');
      setPointsOfSale(data ?? []);
    }
    loadPos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit() {
    const qty = Number(quantity);
    if (!posId) {
      toast.error('Selecciona la empresa o taller.');
      return;
    }
    if (!qty || qty <= 0) {
      toast.error('Indica cuántas baterías deja.');
      return;
    }
    setSubmitting(true);
    const res = await fetch('/api/scrap-deliveries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        point_of_sale_id: posId,
        quantity: qty,
        weight_kg: weight ? Number(weight) : undefined,
        notes: notes || undefined,
      }),
    });
    const json = await res.json().catch(() => ({}));
    setSubmitting(false);
    if (!res.ok) {
      toast.error(json.error || 'Error al registrar la entrega de chatarra.');
      return;
    }
    toast.success('Entrega de baterías viejas registrada.');
    setPosId('');
    setQuantity('');
    setWeight('');
    setNotes('');
    reload();
  }

  function exportExcel() {
    if (!exportFrom || !exportTo) {
      toast.error('Selecciona un rango de fechas para exportar.');
      return;
    }
    window.open(`/api/exports/chatarra?from=${exportFrom}&to=${exportTo}`, '_blank');
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-semibold text-slate-900">Entrega de baterías viejas (chatarra)</h1>
      <p className="mt-1 text-sm text-slate-500">
        Registra cuántas baterías viejas deja una empresa/taller, y su peso si lo tienes a mano.
      </p>

      <div className="card mt-6">
        <label className="label-field">Empresa o taller *</label>
        <select className="input-field mb-4" value={posId} onChange={(e) => setPosId(e.target.value)}>
          <option value="">Selecciona…</option>
          {pointsOfSale.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label-field">Cuántas deja *</label>
            <input
              type="number"
              min={1}
              className="input-field"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="Ej: 5"
            />
          </div>
          <div>
            <label className="label-field">Peso en kg (opcional)</label>
            <input
              type="number"
              min={0}
              step="0.1"
              className="input-field"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              placeholder="Ej: 62.5"
            />
          </div>
        </div>

        <div className="mt-4">
          <label className="label-field">Observación (opcional)</label>
          <textarea className="input-field" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        <button className="btn-charge mt-4 w-full" disabled={submitting} onClick={submit}>
          {submitting ? 'Guardando…' : 'Registrar entrega'}
        </button>
      </div>

      <div className="card mt-4">
        <p className="text-sm font-medium text-slate-900">Exportar chatarra por día</p>
        <p className="text-xs text-slate-400">Descarga un Excel con las entregas de chatarra del rango de fechas que elijas.</p>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <input type="date" className="input-field" value={exportFrom} onChange={(e) => setExportFrom(e.target.value)} />
          <input type="date" className="input-field" value={exportTo} onChange={(e) => setExportTo(e.target.value)} />
        </div>
        <button className="btn-secondary mt-3 w-full" onClick={exportExcel}>Exportar Excel</button>
      </div>

      <div className="mt-6 space-y-2">
        {loading && <p className="text-sm text-slate-400">Cargando…</p>}
        {!loading && items.length === 0 && (
          <div className="card text-center text-slate-400">Todavía no hay entregas de chatarra registradas.</div>
        )}
        {items.map((s) => (
          <div key={s.id} className="card flex items-center justify-between">
            <div>
              <p className="font-medium text-slate-900">{s.point_of_sale?.name ?? '—'}</p>
              <p className="text-xs text-slate-400">{new Date(s.created_at).toLocaleString('es-ES')}</p>
              {s.notes && <p className="text-xs text-slate-400">Nota: {s.notes}</p>}
            </div>
            <div className="text-right">
              <p className="font-semibold text-slate-900">{s.quantity} uds.</p>
              {s.weight_kg && <p className="text-xs text-slate-500">{s.weight_kg} kg</p>}
            </div>
          </div>
        ))}
      </div>

      <Pagination page={page} pageSize={10} total={total} onPageChange={setPage} />
    </div>
  );
}
