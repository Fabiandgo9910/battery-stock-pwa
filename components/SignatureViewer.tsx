'use client';

import { useEffect, useState } from 'react';

interface SignatureRecord {
  signer_name: string | null;
  notes: string | null;
  signature_data_url: string;
  created_at: string;
}

interface SignatureViewerProps {
  kind: 'driver_delivery' | 'commercial_order' | 'warehouse_sale';
  referenceId: string;
  onClose: () => void;
}

/** Muestra la firma guardada de una entrega concreta (si existe). */
export default function SignatureViewer({ kind, referenceId, onClose }: SignatureViewerProps) {
  const [signature, setSignature] = useState<SignatureRecord | null | undefined>(undefined);

  useEffect(() => {
    async function load() {
      const res = await fetch(`/api/signatures?kind=${kind}&reference_id=${referenceId}`);
      const json = await res.json().catch(() => ({}));
      setSignature(res.ok ? json.signature ?? null : null);
    }
    load();
  }, [kind, referenceId]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
      <div className="w-full sm:max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-slate-900">Firma de la entrega</h2>
        {signature === undefined && <p className="mt-3 text-sm text-slate-400">Cargando…</p>}
        {signature === null && <p className="mt-3 text-sm text-slate-400">No hay firma guardada para esta entrega.</p>}
        {signature && (
          <>
            <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={signature.signature_data_url} alt="Firma" className="mx-auto max-h-48" />
            </div>
            <p className="mt-3 text-sm">
              <span className="text-slate-500">Firmado por:</span> {signature.signer_name || 'No indicado'}
            </p>
            <p className="text-xs text-slate-400">{new Date(signature.created_at).toLocaleString('es-ES')}</p>
            {signature.notes && (
              <p className="mt-2 text-sm"><span className="text-slate-500">Observación:</span> {signature.notes}</p>
            )}
          </>
        )}
        <button className="btn-secondary mt-6 w-full" onClick={onClose}>Cerrar</button>
      </div>
    </div>
  );
}
