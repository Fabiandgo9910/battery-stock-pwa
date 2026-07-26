'use client';

import { useEffect, useState } from 'react';
import BarcodeScanner from '@/components/BarcodeScanner';
import ErrorBoundary from '@/components/ErrorBoundary';
import ConfirmModal from '@/components/ConfirmModal';
import toast from 'react-hot-toast';
import { createBrowserClient } from '@/lib/supabaseClient';
import type { ProductModel, Profile } from '@/types/domain';

interface ReturnRow {
  id: string;
  type: 'devolucion' | 'garantia';
  quantity: number;
  source: string;
  created_at: string;
  product_model: { brand: string; model_name: string } | null;
  source_driver: { full_name: string } | null;
}

export default function DevolucionesPage() {
  const supabase = createBrowserClient();
  const [drivers, setDrivers] = useState<Profile[]>([]);
  const [returns, setReturns] = useState<ReturnRow[]>([]);
  const [loadingList, setLoadingList] = useState(true);

  const [returnType, setReturnType] = useState<'devolucion' | 'garantia'>('devolucion');
  const [sourceKind, setSourceKind] = useState<'driver' | 'other'>('other');
  const [driverId, setDriverId] = useState('');
  const [model, setModel] = useState<ProductModel | null>(null);
  const [looking, setLooking] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function loadReturns() {
    setLoadingList(true);
    const res = await fetch('/api/returns');
    const json = await res.json();
    setReturns(json.returns ?? []);
    setLoadingList(false);
  }

  useEffect(() => {
    async function load() {
      const { data: d } = await supabase.from('profiles').select('*').eq('role', 'conductor').eq('active', true).order('full_name');
      setDrivers(d ?? []);
    }
    load();
    loadReturns();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleScan(code: string) {
    setLooking(true);
    try {
      const res = await fetch(`/api/reception/lookup?ean=${encodeURIComponent(code)}`);
      const json = await res.json();
      if (!json.found) {
        toast.error('Código no reconocido en el catálogo.');
        return;
      }
      setModel(json.product_model);
    } finally {
      setLooking(false);
    }
  }

  function reset() {
    setModel(null);
    setQuantity(1);
    setNotes('');
    setSourceKind('other');
    setDriverId('');
    setReturnType('devolucion');
  }

  async function submit() {
    if (sourceKind === 'driver' && !driverId) {
      toast.error('Selecciona de qué conductor viene la devolución.');
      return;
    }
    setSubmitting(true);
    const res = await fetch('/api/returns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: returnType,
        product_model_id: model!.id,
        quantity,
        source_driver_id: sourceKind === 'driver' ? driverId : undefined,
        notes: notes || undefined,
      }),
    });
    const json = await res.json().catch(() => ({}));
    setSubmitting(false);
    setConfirmOpen(false);
    if (!res.ok) {
      toast.error(json.error || 'Error al registrar la devolución.');
      return;
    }
    toast.success(
      returnType === 'garantia'
        ? 'Devolución de garantía registrada en el almacén de garantías.'
        : 'Devolución registrada, ya está de vuelta en el stock vendible.'
    );
    reset();
    loadReturns();
  }

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="text-2xl font-semibold text-slate-900">Devoluciones</h1>
      <p className="mt-1 text-sm text-slate-500">
        Registra una devolución simple (vuelve al stock vendible) o de garantía (se guarda aparte,
        en el almacén de garantías, sin mezclarse con lo que se puede vender).
      </p>

      <div className="card mt-6">
        <label className="label-field">Tipo de devolución *</label>
        <div className="mb-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setReturnType('devolucion')}
            className={`rounded-xl border px-3 py-2.5 text-sm font-medium ${
              returnType === 'devolucion' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-600'
            }`}
          >
            Devolución simple
          </button>
          <button
            type="button"
            onClick={() => setReturnType('garantia')}
            className={`rounded-xl border px-3 py-2.5 text-sm font-medium ${
              returnType === 'garantia' ? 'border-charge-500 bg-charge-400 text-slate-900' : 'border-slate-200 text-slate-600'
            }`}
          >
            Garantía
          </button>
        </div>

        <label className="label-field">¿De dónde viene? *</label>
        <div className="mb-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setSourceKind('other')}
            className={`rounded-xl border px-3 py-2.5 text-sm font-medium ${
              sourceKind === 'other' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-600'
            }`}
          >
            Cliente / taller directo
          </button>
          <button
            type="button"
            onClick={() => setSourceKind('driver')}
            className={`rounded-xl border px-3 py-2.5 text-sm font-medium ${
              sourceKind === 'driver' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-600'
            }`}
          >
            De un conductor
          </button>
        </div>

        {sourceKind === 'driver' && (
          <select className="input-field mb-4" value={driverId} onChange={(e) => setDriverId(e.target.value)}>
            <option value="">Selecciona conductor…</option>
            {drivers.map((d) => (
              <option key={d.id} value={d.id}>{d.full_name}</option>
            ))}
          </select>
        )}

        {!model && (
          <>
            <ErrorBoundary fallbackTitle="No se pudo iniciar la cámara. Comprueba los permisos o usa un lector físico.">
              <BarcodeScanner active={!model} onScan={handleScan} />
            </ErrorBoundary>
            {looking && <p className="mt-2 text-center text-sm text-charge-700">Buscando modelo…</p>}
          </>
        )}

        {model && (
          <>
            <div className="rounded-xl bg-slate-50 p-4">
              <p className="font-semibold text-slate-900">{model.brand} {model.model_name}</p>
            </div>
            <div className="mt-4">
              <label className="label-field">Cantidad</label>
              <input
                type="number"
                min={1}
                className="input-field text-lg font-semibold"
                value={quantity}
                onChange={(e) => setQuantity(Number(e.target.value))}
              />
            </div>
            <div className="mt-4">
              <label className="label-field">Notas (opcional)</label>
              <textarea className="input-field" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <div className="mt-6 flex gap-3">
              <button className="btn-secondary flex-1" onClick={reset}>Cancelar</button>
              <button className="btn-charge flex-1" onClick={() => setConfirmOpen(true)}>Registrar devolución</button>
            </div>
          </>
        )}
      </div>

      <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-slate-500">Últimas devoluciones</h2>
      <div className="mt-3 space-y-2">
        {loadingList && <p className="text-sm text-slate-400">Cargando…</p>}
        {returns.map((r) => (
          <div key={r.id} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm">
            <div>
              <p className="font-medium text-slate-800">
                {r.product_model?.brand} {r.product_model?.model_name}
                <span className={`ml-2 rounded-full px-2 py-0.5 text-xs ${r.type === 'garantia' ? 'bg-charge-100 text-charge-700' : 'bg-slate-100 text-slate-600'}`}>
                  {r.type === 'garantia' ? 'Garantía' : 'Devolución'}
                </span>
              </p>
              <p className="text-xs text-slate-400">
                {r.source_driver ? `De ${r.source_driver.full_name}` : 'Directo de cliente/taller'} ·{' '}
                {new Date(r.created_at).toLocaleString('es-ES')}
              </p>
            </div>
            <strong className="text-slate-900">{r.quantity}</strong>
          </div>
        ))}
        {!loadingList && returns.length === 0 && <p className="text-sm text-slate-400">Sin devoluciones todavía.</p>}
      </div>

      <ConfirmModal
        open={confirmOpen}
        title="Confirmar devolución"
        description={`${quantity} x ${model?.brand} ${model?.model_name} — ${returnType === 'garantia' ? 'irá al almacén de garantías' : 'volverá al stock vendible'}.`}
        confirmLabel="Confirmar"
        loading={submitting}
        onConfirm={submit}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
