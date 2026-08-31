'use client';

interface BatteryUnitLite {
  id: string;
  code: string;
  product_model?: { brand: string; model_name: string } | null;
}

interface BatteryCodeLabelsProps {
  units: BatteryUnitLite[];
  onClose: () => void;
}

/**
 * Muestra los codes de batería recién generados (uno por unidad física) y
 * permite imprimirlos como etiquetas. Se usa justo después de crear/preparar
 * una entrega a conductor, para pegar el code en cada batería antes de que
 * salga del almacén.
 */
export default function BatteryCodeLabels({ units, onClose }: BatteryCodeLabelsProps) {
  if (units.length === 0) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 print:static print:bg-white print:p-0">
      <div className="w-full sm:max-w-lg rounded-2xl bg-white p-6 shadow-xl max-h-[85vh] overflow-y-auto print:max-h-none print:rounded-none print:shadow-none">
        <div className="flex items-center justify-between print:hidden">
          <h2 className="text-lg font-semibold text-slate-900">Codes de batería generados</h2>
          <button className="text-sm text-slate-400" onClick={onClose}>Cerrar</button>
        </div>
        <p className="mt-1 text-sm text-slate-500 print:hidden">
          Pega o etiqueta cada batería física con su code antes de que salga del almacén.
        </p>

        <div id="battery-labels-print-area" className="mt-4 grid grid-cols-2 gap-3 print:grid-cols-3 print:gap-2">
          {units.map((u) => (
            <div
              key={u.id}
              className="rounded-xl border-2 border-dashed border-slate-300 p-3 text-center print:break-inside-avoid"
            >
              <p className="text-[10px] uppercase tracking-wide text-slate-400">
                {u.product_model ? `${u.product_model.brand} ${u.product_model.model_name}` : ''}
              </p>
              <p className="mt-1 font-mono text-lg font-bold tracking-wide text-slate-900">{u.code}</p>
            </div>
          ))}
        </div>

        <div className="mt-6 flex gap-3 print:hidden">
          <button className="btn-secondary flex-1" onClick={onClose}>Cerrar</button>
          <button className="btn-charge flex-1" onClick={() => window.print()}>Imprimir etiquetas</button>
        </div>
      </div>
    </div>
  );
}
