'use client';

import { useState } from 'react';

interface BatteryUnitLite {
  id: string;
  code: string;
  product_model?: { brand: string; model_name: string } | null;
}

interface BatteryCodeLabelsProps {
  units: BatteryUnitLite[];
  onClose: () => void;
}

const LABEL_SIZES = [
  { id: '60x40', label: '60 × 40 mm (habitual)', w: 60, h: 40 },
  { id: '58x40', label: '58 × 40 mm', w: 58, h: 40 },
  { id: '50x30', label: '50 × 30 mm', w: 50, h: 30 },
  { id: '40x30', label: '40 × 30 mm', w: 40, h: 30 },
  { id: '100x50', label: '100 × 50 mm', w: 100, h: 50 },
  { id: 'a4', label: 'Hoja A4 (varias por página)', w: 0, h: 0 },
];

/**
 * Muestra los codes de batería recién generados (uno por unidad física) y
 * permite imprimirlos como etiquetas en una impresora de pegatinas/etiquetas.
 *
 * Cada code se imprime en SU PROPIA página con el tamaño exacto de la
 * etiqueta (@page ajustado en mm), que es como funcionan de verdad las
 * impresoras de etiquetas: una etiqueta = una "página". El bloque de
 * impresión está fuera de cualquier contenedor con scroll para que no se
 * recorte al imprimir (ese era el motivo de que antes no funcionara bien).
 */
export default function BatteryCodeLabels({ units, onClose }: BatteryCodeLabelsProps) {
  const [sizeId, setSizeId] = useState(LABEL_SIZES[0].id);
  if (units.length === 0) return null;

  const size = LABEL_SIZES.find((s) => s.id === sizeId) ?? LABEL_SIZES[0];
  const isA4 = size.id === 'a4';

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 print:hidden">
        <div className="w-full sm:max-w-lg rounded-2xl bg-white p-6 shadow-xl max-h-[85vh] overflow-y-auto">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">Codes de batería generados</h2>
            <button className="text-sm text-slate-400" onClick={onClose}>Cerrar</button>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Pega o etiqueta cada batería física con su code antes de que salga del almacén.
          </p>

          <div className="mt-4">
            <label className="label-field">Tamaño de etiqueta de tu impresora</label>
            <select className="input-field" value={sizeId} onChange={(e) => setSizeId(e.target.value)}>
              {LABEL_SIZES.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
            <p className="mt-1 text-xs text-slate-400">
              Ajusta también el tamaño de papel en el diálogo de impresión del navegador para que
              coincida con este (en impresoras de etiquetas suele llamarse igual que el tamaño del rollo).
            </p>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {units.map((u) => (
              <div key={u.id} className="rounded-xl border-2 border-dashed border-slate-300 p-3 text-center">
                <p className="text-[10px] uppercase tracking-wide text-slate-400">
                  {u.product_model ? `${u.product_model.brand} ${u.product_model.model_name}` : ''}
                </p>
                <p className="mt-1 font-mono text-lg font-bold tracking-wide text-slate-900">{u.code}</p>
              </div>
            ))}
          </div>

          <div className="mt-6 flex gap-3">
            <button className="btn-secondary flex-1" onClick={onClose}>Cerrar</button>
            <button className="btn-charge flex-1" onClick={() => window.print()}>Imprimir etiquetas</button>
          </div>
        </div>
      </div>

      {/* Bloque exclusivo de impresión: HERMANO del modal (nunca dentro de un
          elemento con print:hidden / display:none, o el navegador lo oculta
          también a él y la hoja sale en blanco). Invisible en pantalla,
          visible solo al imprimir. */}
      <div id="battery-labels-print-root" className="hidden print:block">
        <style>{`
          @media print {
            @page { size: ${isA4 ? 'A4' : `${size.w}mm ${size.h}mm`}; margin: ${isA4 ? '10mm' : '2mm'}; }
            .battery-label-page {
              page-break-after: always;
              break-after: page;
              width: 100%;
              height: ${isA4 ? 'auto' : `${size.h - 4}mm`};
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              text-align: center;
            }
            .battery-label-page:last-child { page-break-after: auto; }
          }
        `}</style>
        {isA4 ? (
          <div className="battery-label-page" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4mm', height: 'auto' }}>
            {units.map((u) => (
              <div key={u.id} style={{ border: '1px dashed #94a3b8', padding: '3mm', textAlign: 'center' }}>
                <p style={{ fontSize: '8pt', textTransform: 'uppercase', color: '#64748b', margin: 0 }}>
                  {u.product_model ? `${u.product_model.brand} ${u.product_model.model_name}` : ''}
                </p>
                <p style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '13pt', margin: '2mm 0 0' }}>{u.code}</p>
              </div>
            ))}
          </div>
        ) : (
          units.map((u) => (
            <div key={u.id} className="battery-label-page">
              <p style={{ fontSize: '7pt', textTransform: 'uppercase', color: '#64748b', margin: 0 }}>
                {u.product_model ? `${u.product_model.brand} ${u.product_model.model_name}` : ''}
              </p>
              <p style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '14pt', margin: '1mm 0 0', wordBreak: 'break-all' }}>
                {u.code}
              </p>
            </div>
          ))
        )}
      </div>
    </>
  );
}
