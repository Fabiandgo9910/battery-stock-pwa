'use client';

interface ProductDetailRow {
  brand: string;
  model_name: string;
  reference_code: string | null;
  tech_line: string | null;
  battery_tech: string | null;
  amperage_ah: number | null;
  cold_cranking_amps: number | null;
  polarity: string | null;
  length_mm: number | null;
  width_mm: number | null;
  height_mm: number | null;
  box_code: string | null;
  hold_down_code: string | null;
  weight_kg: number | null;
  pcs_per_layer: number | null;
  layers_per_pallet: number | null;
  pcs_per_pallet: number | null;
  price_pvp: number | null;
  min_stock_alert: number;
  product_ean_codes?: { ean_code: string }[];
}

function Field({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className="text-sm font-medium text-slate-900">{value === null || value === undefined || value === '' ? '—' : value}</p>
    </div>
  );
}

export default function ProductDetailsModal({ model, onClose }: { model: ProductDetailRow; onClose: () => void }) {
  const ean = model.product_ean_codes?.[0]?.ean_code;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
      <div className="w-full sm:max-w-lg rounded-2xl bg-white p-6 shadow-xl max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">{model.brand} {model.model_name}</h2>
          <button className="text-sm text-slate-400" onClick={onClose}>Cerrar</button>
        </div>
        {model.tech_line && <p className="mt-1 text-sm text-charge-700">{model.tech_line}</p>}

        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Field label="EAN" value={ean} />
          <Field label="Referencia (GPN)" value={model.reference_code} />
          <Field label="Tecnología" value={model.battery_tech?.toUpperCase()} />
          <Field label="Capacidad" value={model.amperage_ah ? `${model.amperage_ah} Ah` : null} />
          <Field label="CCA (EN)" value={model.cold_cranking_amps} />
          <Field label="Polaridad" value={model.polarity} />
          <Field label="Largo" value={model.length_mm ? `${model.length_mm} mm` : null} />
          <Field label="Ancho" value={model.width_mm ? `${model.width_mm} mm` : null} />
          <Field label="Alto" value={model.height_mm ? `${model.height_mm} mm` : null} />
          <Field label="Caja" value={model.box_code} />
          <Field label="Sujeción" value={model.hold_down_code} />
          <Field label="Peso" value={model.weight_kg ? `${model.weight_kg} kg` : null} />
          <Field label="Uds. por capa" value={model.pcs_per_layer} />
          <Field label="Capas por palet" value={model.layers_per_pallet} />
          <Field label="Uds. por palet" value={model.pcs_per_pallet} />
          <Field label="PVP" value={model.price_pvp ? `${model.price_pvp} €` : null} />
          <Field label="Aviso stock mínimo" value={model.min_stock_alert} />
        </div>

        <button className="btn-secondary mt-6 w-full" onClick={onClose}>Cerrar</button>
      </div>
    </div>
  );
}
