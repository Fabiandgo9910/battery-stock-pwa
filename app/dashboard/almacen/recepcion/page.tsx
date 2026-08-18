'use client';

import { useEffect, useState } from 'react';
import BarcodeScanner from '@/components/BarcodeScanner';
import ErrorBoundary from '@/components/ErrorBoundary';
import ConfirmModal from '@/components/ConfirmModal';
import QuantityInput from '@/components/QuantityInput';
import toast from 'react-hot-toast';
import { createBrowserClient } from '@/lib/supabaseClient';
import type { ProductModel, Supplier } from '@/types/domain';

type Step = 'scanning' | 'existing' | 'new-model' | 'confirm';

interface ActiveLoan {
  id: string;
  quantity: number;
  quantity_returned: number;
  borrower_name: string;
  product_model: { brand: string; model_name: string } | null;
}

export default function RecepcionPage() {
  const supabase = createBrowserClient();
  const [mode, setMode] = useState<'reception' | 'loan-return'>('reception');
  const [step, setStep] = useState<Step>('scanning');
  const [ean, setEan] = useState('');
  const [foundModel, setFoundModel] = useState<ProductModel | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierId, setSupplierId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [quantity, setQuantity] = useState(0);
  const [notes, setNotes] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [editingExisting, setEditingExisting] = useState(false);

  // Modo "devolución de préstamo"
  const [activeLoans, setActiveLoans] = useState<ActiveLoan[]>([]);
  const [loanSearch, setLoanSearch] = useState('');
  const [selectedLoan, setSelectedLoan] = useState<ActiveLoan | null>(null);
  const [loanReturnQty, setLoanReturnQty] = useState(0);
  const [loanReturnNotes, setLoanReturnNotes] = useState('');
  const [loanConfirmOpen, setLoanConfirmOpen] = useState(false);

  // Formulario de modelo nuevo
  const [brand, setBrand] = useState('');
  const [modelName, setModelName] = useState('');
  const [amperage, setAmperage] = useState('');
  const [cca, setCca] = useState('');
  const [tech, setTech] = useState<'normal' | 'agm' | 'efb'>('normal');
  const [isSpecial, setIsSpecial] = useState(false);
  const [specialReason, setSpecialReason] = useState('');

  useEffect(() => {
    async function loadBase() {
      const { data: sup } = await supabase.from('suppliers').select('*').eq('active', true).order('name');
      setSuppliers(sup ?? []);
      const { data: wh } = await supabase.from('warehouses').select('*').eq('active', true).eq('is_warranty_holding', false).limit(1).single();
      if (wh) setWarehouseId(wh.id);
    }
    loadBase();
  }, [supabase]);

  useEffect(() => {
    async function loadLoans() {
      if (mode !== 'loan-return') return;
      const res = await fetch('/api/loans');
      const json = await res.json();
      const loans: ActiveLoan[] = (json.loans ?? []).filter((l: any) => l.status !== 'devuelto');
      setActiveLoans(loans);
    }
    loadLoans();
  }, [mode]);

  async function handleScan(code: string) {
    setEan(code);
    const res = await fetch(`/api/reception/lookup?ean=${encodeURIComponent(code)}`);
    const json = await res.json();
    if (json.found) {
      setFoundModel(json.product_model);
      setStep('existing');
    } else {
      setFoundModel(null);
      setStep('new-model');
    }
  }

  function resetFlow() {
    setStep('scanning');
    setEan('');
    setFoundModel(null);
    setQuantity(0);
    setNotes('');
    setBrand('');
    setModelName('');
    setAmperage('');
    setCca('');
    setTech('normal');
    setIsSpecial(false);
    setSpecialReason('');
    setEditingExisting(false);
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
    const json = await res.json();
    setSubmitting(false);
    if (!res.ok) {
      toast.error(json.error?.formErrors?.[0] || json.error || 'Error al crear el modelo');
      return;
    }
    setFoundModel(json.product_model);
    setStep('existing');
    toast.success('Modelo de batería creado. Ahora indica la cantidad recibida.');
  }

  function startEditExisting() {
    if (!foundModel) return;
    setBrand(foundModel.brand);
    setModelName(foundModel.model_name);
    setAmperage(foundModel.amperage_ah?.toString() ?? '');
    setCca(foundModel.cold_cranking_amps?.toString() ?? '');
    setTech(foundModel.battery_tech ?? 'normal');
    setIsSpecial(foundModel.is_special);
    setSpecialReason(foundModel.special_reason ?? '');
    setEditingExisting(true);
  }

  async function saveExistingEdit() {
    if (!foundModel) return;
    if (!brand || !modelName) {
      toast.error('Marca y modelo son obligatorios.');
      return;
    }
    setSubmitting(true);
    const res = await fetch(`/api/product-models/${foundModel.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        brand,
        model_name: modelName,
        amperage_ah: amperage ? Number(amperage) : null,
        cold_cranking_amps: cca ? Number(cca) : null,
        battery_tech: tech,
        is_special: isSpecial,
        special_reason: isSpecial ? specialReason : null,
      }),
    });
    const json = await res.json().catch(() => ({}));
    setSubmitting(false);
    if (!res.ok) {
      toast.error(json.error || 'Error al guardar los cambios.');
      return;
    }
    setFoundModel({
      ...foundModel,
      brand,
      model_name: modelName,
      amperage_ah: amperage ? Number(amperage) : null as any,
      cold_cranking_amps: cca ? Number(cca) : null as any,
      battery_tech: tech,
      is_special: isSpecial,
      special_reason: isSpecial ? specialReason : null,
    });
    setEditingExisting(false);
    toast.success('Modelo actualizado.');
  }

  async function submitLoanReturn() {
    if (!selectedLoan) return;
    setSubmitting(true);
    const res = await fetch(`/api/loans/${selectedLoan.id}/return`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quantity: loanReturnQty, notes: loanReturnNotes || undefined }),
    });
    const json = await res.json().catch(() => ({}));
    setSubmitting(false);
    setLoanConfirmOpen(false);
    if (!res.ok) {
      toast.error(json.error || 'Error al registrar la devolución.');
      return;
    }
    toast.success('Devolución de préstamo registrada. Stock repuesto en el almacén.');
    setSelectedLoan(null);
    setLoanReturnQty(0);
    setLoanReturnNotes('');
    const res2 = await fetch('/api/loans');
    const json2 = await res2.json();
    setActiveLoans((json2.loans ?? []).filter((l: any) => l.status !== 'devuelto'));
  }

  async function submitReception() {
    if (!supplierId) {
      toast.error('Selecciona la empresa distribuidora.');
      return;
    }
    setSubmitting(true);
    const res = await fetch('/api/reception', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        warehouse_id: warehouseId,
        supplier_id: supplierId,
        product_model_id: foundModel!.id,
        ean_code: ean,
        quantity,
        notes,
      }),
    });
    const json = await res.json();
    setSubmitting(false);
    setConfirmOpen(false);
    if (!res.ok) {
      toast.error(json.error || 'Error al registrar la recepción');
      return;
    }
    toast.success(`Stock actualizado: +${quantity} unidades`);
    resetFlow();
  }

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="text-2xl font-semibold text-slate-900">Recepción de mercancía</h1>
      <p className="mt-1 text-sm text-slate-500">
        Escanea el código EAN del palet o unidad para dar entrada al almacén.
      </p>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setMode('reception')}
          className={`rounded-xl border px-3 py-2.5 text-sm font-medium ${
            mode === 'reception' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-600'
          }`}
        >
          Recepción normal
        </button>
        <button
          type="button"
          onClick={() => setMode('loan-return')}
          className={`rounded-xl border px-3 py-2.5 text-sm font-medium ${
            mode === 'loan-return' ? 'border-charge-500 bg-charge-400 text-slate-900' : 'border-slate-200 text-slate-600'
          }`}
        >
          Es devolución de un préstamo
        </button>
      </div>

      {mode === 'loan-return' && (
        <div className="card mt-4">
          {!selectedLoan ? (
            <>
              <label className="label-field">Busca el préstamo (por quién lo tiene o la batería)</label>
              <input
                className="input-field"
                placeholder="Buscar…"
                value={loanSearch}
                onChange={(e) => setLoanSearch(e.target.value)}
              />
              <div className="mt-3 space-y-2">
                {activeLoans
                  .filter((l) =>
                    `${l.borrower_name} ${l.product_model?.brand ?? ''} ${l.product_model?.model_name ?? ''}`
                      .toLowerCase()
                      .includes(loanSearch.toLowerCase())
                  )
                  .map((loan) => (
                    <button
                      key={loan.id}
                      onClick={() => {
                        setSelectedLoan(loan);
                        setLoanReturnQty(0);
                      }}
                      className="flex w-full items-center justify-between rounded-xl border border-slate-100 px-3 py-2 text-left hover:bg-slate-50"
                    >
                      <div>
                        <p className="text-sm font-medium text-slate-900">
                          {loan.product_model?.brand} {loan.product_model?.model_name}
                        </p>
                        <p className="text-xs text-slate-500">Con {loan.borrower_name}</p>
                      </div>
                      <span className="text-sm font-semibold text-charge-700">
                        {loan.quantity - loan.quantity_returned} pend.
                      </span>
                    </button>
                  ))}
                {activeLoans.length === 0 && (
                  <p className="text-sm text-slate-400">No hay préstamos activos.</p>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="rounded-xl bg-slate-50 p-4">
                <p className="font-semibold text-slate-900">
                  {selectedLoan.product_model?.brand} {selectedLoan.product_model?.model_name}
                </p>
                <p className="text-sm text-slate-500">Prestado a {selectedLoan.borrower_name}</p>
              </div>
              <div className="mt-4">
                <label className="label-field">
                  Cantidad devuelta (pendiente: {selectedLoan.quantity - selectedLoan.quantity_returned})
                </label>
                <QuantityInput
                  value={loanReturnQty}
                  onChange={setLoanReturnQty}
                  max={selectedLoan.quantity - selectedLoan.quantity_returned}
                  className="input-field text-lg font-semibold"
                />
              </div>
              <div className="mt-4">
                <label className="label-field">Observaciones</label>
                <textarea
                  className="input-field"
                  rows={2}
                  value={loanReturnNotes}
                  onChange={(e) => setLoanReturnNotes(e.target.value)}
                />
              </div>
              <div className="mt-6 flex gap-3">
                <button className="btn-secondary flex-1" onClick={() => setSelectedLoan(null)}>Volver</button>
                <button
                  className="btn-charge flex-1"
                  onClick={() => {
                    if (loanReturnQty <= 0) {
                      toast.error('Indica una cantidad mayor que 0.');
                      return;
                    }
                    setLoanConfirmOpen(true);
                  }}
                >
                  Registrar devolución
                </button>
              </div>
            </>
          )}
        </div>
      )}

      <div className={`card mt-6 ${mode === 'reception' && step === 'scanning' ? '' : 'hidden'}`}>
        <ErrorBoundary fallbackTitle="No se pudo iniciar la cámara. Comprueba los permisos o usa un lector físico.">
          <BarcodeScanner active={step === 'scanning'} onScan={handleScan} />
        </ErrorBoundary>
        <div className="mt-4">
          <label className="label-field">O introduce el código manualmente</label>
          <div className="flex gap-2">
            <input
              className="input-field"
              value={ean}
              onChange={(e) => setEan(e.target.value)}
              placeholder="Código EAN"
            />
            <button className="btn-secondary" onClick={() => ean && handleScan(ean)}>
              Buscar
            </button>
          </div>
        </div>
      </div>

      {step === 'new-model' && (
        <div className="card mt-6">
          <p className="mb-4 rounded-xl bg-charge-50 px-4 py-2 text-sm text-charge-700">
            Código <strong>{ean}</strong> no encontrado. Rellena los datos de esta batería.
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
                id="special"
                type="checkbox"
                checked={isSpecial}
                onChange={(e) => setIsSpecial(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300"
              />
              <label htmlFor="special" className="text-sm text-slate-700">
                Es una batería especial
              </label>
            </div>
            {isSpecial && (
              <div>
                <label className="label-field">Motivo</label>
                <input className="input-field" value={specialReason} onChange={(e) => setSpecialReason(e.target.value)} />
              </div>
            )}
          </div>
          <div className="mt-6 flex gap-3">
            <button className="btn-secondary flex-1" onClick={resetFlow}>Cancelar</button>
            <button className="btn-charge flex-1" disabled={submitting} onClick={createNewModelAndContinue}>
              {submitting ? 'Guardando…' : 'Guardar y continuar'}
            </button>
          </div>
        </div>
      )}

      {step === 'existing' && foundModel && !editingExisting && (
        <div className="card mt-6">
          <div className="rounded-xl bg-slate-50 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-slate-900">{foundModel.brand} {foundModel.model_name}</p>
                <p className="text-sm text-slate-500">
                  {foundModel.amperage_ah ? `${foundModel.amperage_ah} Ah` : ''}
                  {foundModel.cold_cranking_amps ? ` · ${foundModel.cold_cranking_amps} CCA` : ''}
                  {foundModel.battery_tech ? ` · ${foundModel.battery_tech.toUpperCase()}` : ''}
                </p>
                {foundModel.is_special && (
                  <p className="mt-1 text-xs text-charge-700">Especial: {foundModel.special_reason}</p>
                )}
                <p className="mt-1 text-xs text-slate-400">EAN: {ean}</p>
              </div>
              <button
                type="button"
                onClick={startEditExisting}
                className="shrink-0 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-white"
              >
                Editar
              </button>
            </div>
          </div>

          <div className="mt-4 space-y-4">
            <div>
              <label className="label-field">Empresa distribuidora *</label>
              <select className="input-field" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                <option value="">Selecciona…</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label-field">Cantidad recibida *</label>
              <QuantityInput value={quantity} onChange={setQuantity} className="input-field text-lg font-semibold" />
            </div>
            <div>
              <label className="label-field">Notas (opcional)</label>
              <textarea className="input-field" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>

          <div className="mt-6 flex gap-3">
            <button className="btn-secondary flex-1" onClick={resetFlow}>Cancelar</button>
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
              Registrar entrada
            </button>
          </div>
        </div>
      )}

      {step === 'existing' && foundModel && editingExisting && (
        <div className="card mt-6">
          <p className="mb-4 rounded-xl bg-charge-50 px-4 py-2 text-sm text-charge-700">
            Editando {foundModel.brand} {foundModel.model_name} (EAN: {ean})
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
                id="edit-existing-special"
                type="checkbox"
                checked={isSpecial}
                onChange={(e) => setIsSpecial(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300"
              />
              <label htmlFor="edit-existing-special" className="text-sm text-slate-700">
                Es una batería especial
              </label>
            </div>
            {isSpecial && (
              <div>
                <label className="label-field">Motivo</label>
                <input className="input-field" value={specialReason} onChange={(e) => setSpecialReason(e.target.value)} />
              </div>
            )}
          </div>
          <div className="mt-6 flex gap-3">
            <button className="btn-secondary flex-1" onClick={() => setEditingExisting(false)}>Cancelar</button>
            <button className="btn-charge flex-1" disabled={submitting} onClick={saveExistingEdit}>
              {submitting ? 'Guardando…' : 'Guardar cambios'}
            </button>
          </div>
        </div>
      )}

      <ConfirmModal
        open={confirmOpen}
        title="Confirmar recepción"
        description={`Vas a añadir ${quantity} unidades de ${foundModel?.brand} ${foundModel?.model_name} al almacén.`}
        confirmLabel="Sí, registrar"
        loading={submitting}
        onConfirm={submitReception}
        onCancel={() => setConfirmOpen(false)}
      />

      <ConfirmModal
        open={loanConfirmOpen}
        title="Confirmar devolución de préstamo"
        description={`Se repondrán ${loanReturnQty} unidades de ${selectedLoan?.product_model?.brand} ${selectedLoan?.product_model?.model_name} en el almacén.`}
        confirmLabel="Sí, registrar"
        loading={submitting}
        onConfirm={submitLoanReturn}
        onCancel={() => setLoanConfirmOpen(false)}
      />
    </div>
  );
}
