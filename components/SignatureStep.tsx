'use client';

import { useState } from 'react';
import SignaturePad from '@/components/SignaturePad';

export interface SignatureResult {
  signerName: string;
  notes: string;
  signatureDataUrl: string;
}

interface SignatureStepProps {
  title: string;
  description?: string;
  confirmLabel?: string;
  onConfirm: (result: SignatureResult) => void;
  onCancel: () => void;
  submitting?: boolean;
}

/**
 * Paso final de cualquier entrega desde almacén (a conductor, a comercial, o
 * venta directa): quien recibe firma en pantalla y, si hace falta, deja una
 * observación. Solo entonces se puede confirmar la entrega.
 */
export default function SignatureStep({
  title,
  description,
  confirmLabel = 'Confirmar entrega',
  onConfirm,
  onCancel,
  submitting = false,
}: SignatureStepProps) {
  const [signerName, setSignerName] = useState('');
  const [notes, setNotes] = useState('');
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);
  const [error, setError] = useState('');

  function handleConfirm() {
    if (!signatureDataUrl) {
      setError('Falta la firma de quien recibe la entrega.');
      return;
    }
    setError('');
    onConfirm({ signerName: signerName.trim(), notes: notes.trim(), signatureDataUrl });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
      <div className="w-full sm:max-w-md rounded-2xl bg-white p-6 shadow-xl max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}

        <div className="mt-4">
          <label className="label-field">Nombre de quien recibe (opcional)</label>
          <input
            className="input-field"
            value={signerName}
            onChange={(e) => setSignerName(e.target.value)}
            placeholder="Nombre y apellidos"
          />
        </div>

        <div className="mt-4">
          <label className="label-field">Observación de esta entrega</label>
          <textarea
            className="input-field"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Cualquier incidencia o nota sobre esta entrega (opcional)"
          />
        </div>

        <div className="mt-4">
          <label className="label-field">Firma de quien recibe *</label>
          <SignaturePad onChange={setSignatureDataUrl} />
        </div>

        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

        <div className="mt-6 flex gap-3">
          <button type="button" className="btn-secondary flex-1" onClick={onCancel} disabled={submitting}>
            Cancelar
          </button>
          <button type="button" className="btn-charge flex-1" onClick={handleConfirm} disabled={submitting}>
            {submitting ? 'Guardando…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
