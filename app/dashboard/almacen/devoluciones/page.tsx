'use client';

import { useEffect, useState } from 'react';
import BarcodeScanner from '@/components/BarcodeScanner';
import ErrorBoundary from '@/components/ErrorBoundary';
import ConfirmModal from '@/components/ConfirmModal';
import QuantityInput from '@/components/QuantityInput';
import Pagination from '@/components/Pagination';
import { usePagination } from '@/hooks/usePagination';
import toast from 'react-hot-toast';
import { createBrowserClient } from '@/lib/supabaseClient';
import type { ProductModel, Profile } from '@/types/domain';

interface ReturnRow {
  id: string;
  type: 'devolucion' | 'garantia';
  quantity: number;
  source: string;
  notes: string | null;
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
  const [ean, setEan] = useState('');
  const [model, setModel] = useState<ProductModel | null>(null);
  const [looking, setLooking] = useState(false);
  const [quantity, setQuantity] = useState(0);
  const [notes, setNotes] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Cuando el EAN escaneado no existe en el catálogo, se da de alta el
  // modelo aquí mismo — igual que en Recepción — porque una batería
  // devuelta (sobre todo de garantía) puede no estar registrada todavía.
  const [creatingNewModel, setCreatingNewModel] = useState(false);
  const [brand, setBrand] = useState('');
  const [modelName, setModelName] = useState('');
  const [amperage, setAmperage] = useState('');
  const [cca, setCca] = useState('');
  const [tech, setTech] = useState<'normal' | 'agm' | 'efb'>('normal');
  const [isSpecial, setIsSpecial] = useState(false);
  const [specialReason, setSpecialReason] = useState('');

  const {
    page: returnsPage,
    setPage: setReturnsPage,
    pageItems: returnsPageItems,
    total: returnsTotal,
  } = usePagination(returns, 10);

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
    setEan(code);
    setLooking(true);
    try {
      const res = await fetch(`/api/reception/lookup?ean=${encodeURIComponent(code)}`);
      const json = await res.json();
      if (!json.found) {
        // No está en el catálogo: lo damos de alta aquí, como en Recepción.
        setCreatingNewModel(true);
        setBrand('');
        setModelName('');
        setAmperage('');
        setCca('');
        setTech('normal');
        setIsSpecial(false);
        setSpecialReason('');
        return;
      }
      setModel(json.product_model);
    } finally {
      setLooking(false);
    }
  }

  async function createNewModelAndContinue() {
    if (!brand || !modelName) {
      toast.error('Marca y modelo son obligatorios.');
      return;
    }
    setSubmitting(true);
    const res = await fetch('/api/product-models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ean_code: ean,
        brand,
        model_name: modelName,
        amperage_ah: amperage ? Number(amperage) : undefined,
        cold_cranking_amps: cca ? Number(cca) : undefined,
        battery_tech: tech,
        is_special: isSpecial,
        special_reason: isSpecial ? specialReason : undefined,
      }),
    });
    const json = await res.json().catch(() => ({}));
    setSubmitting(false);
    if (!res.ok) {
      toast.error(json.error || 'Error al crear el modelo.');
      return;
    }
    setModel(json.product_model);
    setCreatingNewModel(false);
    toast.success('Modelo dado de alta. Ahora indica la cantidad devuelta.');
  }

  function reset() {
    setEan('');
    setModel(null);
    setCreatingNewModel(false);
    setQuantity(0);
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
        en el almacén de garantías, sin mezclarse con lo que se puede vender). No hace falta que la
        batería estuviera antes en ningún stock: si el EAN no está en el catálogo, se da de alta aquí
        mismo, igual que en Recepción.
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

        {!model && !creatingNewModel && (
          <>
            <ErrorBoundary fallbackTitle="No se pudo iniciar la cámara. Comprueba los permisos o usa un lector físico.">
              <BarcodeScanner active={!model && !creatingNewModel} onScan={handleScan} />
            </ErrorBoundary>
            {looking && <p className="mt-2 text-center text-sm text-charge-700">Buscando modelo…</p>}
          </>
        )}

        {creatingNewModel && (
          <div>
            <p className="mb-4 rounded-xl bg-charge-50 px-4 py-2 text-sm text-charge-700">
              Código <strong>{ean}</strong> no encontrado en el catálogo. Rellena los datos de esta batería.
            </p>
            <div className="space-y-4">
              <div>
                <label className="label-field">Marca *</label>
                <input className="input-field" value={brand} onChange={(e) => setBrand(e.target.value)} />
              </div>
              <div>
                <label className="label-field">Modelo *</label>
                <input className="input-field" value={modelName} onChange={(e) => setModelName(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label-field">Amperaje (Ah)</label>
                  <input type="number" className="input-field" value={amperage} onChange={(e) => setAmperage(e.target.value)} />
                </div>
                <div>
                  <label className="label-field">Arranque en frío (CCA)</label>
                  <input type="number" className="input-field" value={cca} onChange={(e) => setCca(e.target.value)} />
                </div>
              </div>
              <div>
                <label className="label-field">Tecnología</label>
                <select className="input-field" value={tech} onChange={(e) => setTech(e.target.value as any)}>
                  <option value="normal">Normal</option>
                  <option value="agm">AGM</option>
                  <option value="efb">EFB</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                <input
                  id="return-special"
                  type="checkbox"
                  checked={isSpecial}
                  onChange={(e) => setIsSpecial(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300"
                />
                <label htmlFor="return-special" className="text-sm text-slate-700">Es una batería especial</label>
              </div>
              {isSpecial && (
                <div>
                  <label className="label-field">Motivo</label>
                  <input className="input-field" value={specialReason} onChange={(e) => setSpecialReason(e.target.value)} />
                </div>
              )}
            </div>
            <div className="mt-6 flex gap-3">
              <button className="btn-secondary flex-1" onClick={reset}>Cancelar</button>
              <button className="btn-charge flex-1" disabled={submitting} onClick={createNewModelAndContinue}>
                {submitting ? 'Guardando…' : 'Guardar y continuar'}
              </button>
            </div>
          </div>
        )}

        {model && (
          <>
            <div className="rounded-xl bg-slate-50 p-4">
              <p className="font-semibold text-slate-900">{model.brand} {model.model_name}</p>
            </div>
            <div className="mt-4">
              <label className="label-field">Cantidad</label>
              <QuantityInput value={quantity} onChange={setQuantity} className="input-field text-lg font-semibold" />
            </div>
            <div className="mt-4">
              <label className="label-field">Observaciones</label>
              <textarea
                className="input-field"
                rows={3}
                placeholder="Motivo de la devolución, estado de la batería, referencia del cliente, etc."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
            <div className="mt-6 flex gap-3">
              <button className="btn-secondary flex-1" onClick={reset}>Cancelar</button>
              <button
                className="btn-charge flex-1"
                onClick={() => {
                  if (quantity <= 0) {
                    toast.error('Indica una cantidad mayor que 0.');
                    return;
                  }
                  setConfirmOpen(true);
                }}
              >
                Registrar devolución
              </button>
            </div>
          </>
        )}
      </div>

      <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-slate-500">Últimas devoluciones</h2>
      <div className="mt-3 space-y-2">
        {loadingList && <p className="text-sm text-slate-400">Cargando…</p>}
        {returnsPageItems.map((r) => (
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
              {r.notes && <p className="mt-0.5 text-xs text-slate-500">"{r.notes}"</p>}
            </div>
            <strong className="text-slate-900">{r.quantity}</strong>
          </div>
        ))}
        {!loadingList && returns.length === 0 && <p className="text-sm text-slate-400">Sin devoluciones todavía.</p>}
      </div>

      <Pagination page={returnsPage} pageSize={10} total={returnsTotal} onPageChange={setReturnsPage} />

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
