'use client';

import { useEffect, useState } from 'react';
import BarcodeScanner from '@/components/BarcodeScanner';
import ErrorBoundary from '@/components/ErrorBoundary';
import ConfirmModal from '@/components/ConfirmModal';
import QuantityInput from '@/components/QuantityInput';
import Pagination from '@/components/Pagination';
import { usePagination } from '@/hooks/usePagination';
import toast from 'react-hot-toast';
import type { ProductModel } from '@/types/domain';

interface Loan {
  id: string;
  quantity: number;
  quantity_returned: number;
  status: 'prestado' | 'parcial' | 'devuelto';
  borrower_name: string;
  borrower_contact: string | null;
  loaned_at: string;
  notes: string | null;
  product_model: { brand: string; model_name: string } | null;
  loaned_by_profile: { full_name: string } | null;
  loan_returns: { id: string; quantity: number; returned_at: string; notes: string | null }[];
}

const STATUS_LABEL: Record<Loan['status'], string> = {
  prestado: 'Prestado',
  parcial: 'Devuelto parcialmente',
  devuelto: 'Devuelto',
};
const STATUS_STYLE: Record<Loan['status'], string> = {
  prestado: 'bg-amber-100 text-amber-700',
  parcial: 'bg-charge-100 text-charge-700',
  devuelto: 'bg-emerald-100 text-emerald-700',
};

export default function PrestamosPage() {
  const [loans, setLoans] = useState<Loan[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [model, setModel] = useState<ProductModel | null>(null);
  const [looking, setLooking] = useState(false);
  const [quantity, setQuantity] = useState(0);
  const [borrowerName, setBorrowerName] = useState('');
  const [borrowerContact, setBorrowerContact] = useState('');
  const [notes, setNotes] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);

  const [returnTarget, setReturnTarget] = useState<Loan | null>(null);
  const [returnQty, setReturnQty] = useState(0);
  const [returnNotes, setReturnNotes] = useState('');
  const [returnConfirmOpen, setReturnConfirmOpen] = useState(false);

  async function load() {
    setLoading(true);
    const res = await fetch('/api/loans');
    const json = await res.json();
    setLoans(json.loans ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
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

  function resetForm() {
    setModel(null);
    setQuantity(0);
    setBorrowerName('');
    setBorrowerContact('');
    setNotes('');
    setShowForm(false);
  }

  async function submitLoan() {
    if (!model) return;
    setSubmitting(true);
    const res = await fetch('/api/loans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        product_model_id: model.id,
        quantity,
        borrower_name: borrowerName,
        borrower_contact: borrowerContact || undefined,
        notes: notes || undefined,
      }),
    });
    const json = await res.json().catch(() => ({}));
    setSubmitting(false);
    setConfirmOpen(false);
    if (!res.ok) {
      toast.error(json.error || 'Error al registrar el préstamo.');
      return;
    }
    toast.success('Préstamo registrado y descontado del almacén.');
    resetForm();
    load();
  }

  function openReturn(loan: Loan) {
    setReturnTarget(loan);
    setReturnQty(0);
    setReturnNotes('');
  }

  async function submitReturn() {
    if (!returnTarget) return;
    setSubmitting(true);
    const res = await fetch(`/api/loans/${returnTarget.id}/return`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quantity: returnQty, notes: returnNotes || undefined }),
    });
    const json = await res.json().catch(() => ({}));
    setSubmitting(false);
    setReturnConfirmOpen(false);
    if (!res.ok) {
      toast.error(json.error || 'Error al registrar la devolución.');
      return;
    }
    toast.success('Devolución registrada. Stock repuesto en el almacén.');
    setReturnTarget(null);
    load();
  }

  const filtered = loans.filter((l) =>
    `${l.borrower_name} ${l.product_model?.brand ?? ''} ${l.product_model?.model_name ?? ''}`.toLowerCase().includes(search.toLowerCase())
  );
  const { page, setPage, pageItems, total } = usePagination(filtered, 10);

  return (
    <div className="mx-auto max-w-2xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Préstamos</h1>
          <p className="mt-1 text-sm text-slate-500">
            Salen del almacén sin ser una venta. Si te las devuelven, repón el stock desde aquí (o
            marca la devolución como "préstamo" en Recepción).
          </p>
        </div>
        <button className="btn-charge" onClick={() => (showForm ? resetForm() : setShowForm(true))}>
          {showForm ? 'Cerrar' : '+ Nuevo'}
        </button>
      </div>

      {showForm && (
        <div className="card mt-6">
          {!model ? (
            <>
              <ErrorBoundary fallbackTitle="No se pudo iniciar la cámara.">
                <BarcodeScanner active onScan={handleScan} />
              </ErrorBoundary>
              {looking && <p className="mt-2 text-center text-sm text-charge-700">Buscando modelo…</p>}
            </>
          ) : (
            <>
              <div className="rounded-xl bg-slate-50 p-4">
                <p className="font-semibold text-slate-900">{model.brand} {model.model_name}</p>
              </div>
              <div className="mt-4 space-y-4">
                <div>
                  <label className="label-field">Cantidad</label>
                  <QuantityInput value={quantity} onChange={setQuantity} className="input-field text-lg font-semibold" />
                </div>
                <div>
                  <label className="label-field">¿A quién se le presta? *</label>
                  <input className="input-field" value={borrowerName} onChange={(e) => setBorrowerName(e.target.value)} />
                </div>
                <div>
                  <label className="label-field">Contacto (opcional)</label>
                  <input className="input-field" value={borrowerContact} onChange={(e) => setBorrowerContact(e.target.value)} />
                </div>
                <div>
                  <label className="label-field">Observaciones</label>
                  <textarea className="input-field" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
                </div>
              </div>
              <div className="mt-6 flex gap-3">
                <button className="btn-secondary flex-1" onClick={resetForm}>Cancelar</button>
                <button
                  className="btn-charge flex-1"
                  onClick={() => {
                    if (quantity <= 0) {
                      toast.error('Indica una cantidad mayor que 0.');
                      return;
                    }
                    if (!borrowerName.trim()) {
                      toast.error('Indica a quién se le presta.');
                      return;
                    }
                    setConfirmOpen(true);
                  }}
                >
                  Registrar préstamo
                </button>
              </div>
            </>
          )}
        </div>
      )}

      <input
        className="input-field mt-6"
        placeholder="Buscar por quién lo tiene o por batería…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <div className="mt-4 space-y-3">
        {loading && <p className="text-sm text-slate-400">Cargando…</p>}
        {pageItems.map((loan) => {
          const remaining = loan.quantity - loan.quantity_returned;
          return (
            <div key={loan.id} className="card">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-slate-900">{loan.product_model?.brand} {loan.product_model?.model_name}</p>
                  <p className="text-sm text-slate-500">Prestado a {loan.borrower_name} {loan.borrower_contact ? `· ${loan.borrower_contact}` : ''}</p>
                  <p className="text-xs text-slate-400">
                    {new Date(loan.loaned_at).toLocaleString('es-ES')} · por {loan.loaned_by_profile?.full_name ?? '—'}
                  </p>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLE[loan.status]}`}>
                  {STATUS_LABEL[loan.status]}
                </span>
              </div>
              <div className="mt-2 text-sm text-slate-600">
                Prestadas: <strong>{loan.quantity}</strong> · Devueltas: <strong>{loan.quantity_returned}</strong> · Pendientes: <strong>{remaining}</strong>
              </div>
              {loan.notes && <p className="mt-1 text-xs text-slate-400">"{loan.notes}"</p>}
              {remaining > 0 && (
                <button className="btn-secondary mt-3" onClick={() => openReturn(loan)}>
                  Registrar devolución
                </button>
              )}
            </div>
          );
        })}
        {!loading && loans.length === 0 && <div className="card text-center text-slate-400">Sin préstamos todavía.</div>}
      </div>

      <Pagination page={page} pageSize={10} total={total} onPageChange={setPage} />

      <ConfirmModal
        open={confirmOpen}
        title="Confirmar préstamo"
        description={`Se descontarán ${quantity} unidades de ${model?.brand} ${model?.model_name} del almacén, prestadas a ${borrowerName}.`}
        confirmLabel="Sí, registrar"
        loading={submitting}
        onConfirm={submitLoan}
        onCancel={() => setConfirmOpen(false)}
      />

      {returnTarget && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full sm:max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-slate-900">Registrar devolución</h2>
            <p className="mt-1 text-sm text-slate-500">
              {returnTarget.product_model?.brand} {returnTarget.product_model?.model_name} — de {returnTarget.borrower_name}
            </p>
            <div className="mt-4">
              <label className="label-field">
                Cantidad devuelta (pendiente: {returnTarget.quantity - returnTarget.quantity_returned})
              </label>
              <QuantityInput
                value={returnQty}
                onChange={setReturnQty}
                max={returnTarget.quantity - returnTarget.quantity_returned}
                className="input-field text-lg font-semibold"
              />
            </div>
            <div className="mt-4">
              <label className="label-field">Observaciones</label>
              <textarea className="input-field" rows={2} value={returnNotes} onChange={(e) => setReturnNotes(e.target.value)} />
            </div>
            <div className="mt-6 flex gap-3">
              <button className="btn-secondary flex-1" onClick={() => setReturnTarget(null)}>Cancelar</button>
              <button
                className="btn-charge flex-1"
                onClick={() => {
                  if (returnQty <= 0) {
                    toast.error('Indica una cantidad mayor que 0.');
                    return;
                  }
                  setReturnConfirmOpen(true);
                }}
              >
                Registrar
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        open={returnConfirmOpen}
        title="Confirmar devolución de préstamo"
        description={`Se repondrán ${returnQty} unidades en el almacén.`}
        confirmLabel="Sí, registrar"
        loading={submitting}
        onConfirm={submitReturn}
        onCancel={() => setReturnConfirmOpen(false)}
      />
    </div>
  );
}
