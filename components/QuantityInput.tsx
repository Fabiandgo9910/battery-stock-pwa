'use client';

interface QuantityInputProps {
  value: number;
  onChange: (value: number) => void;
  max?: number;
  className?: string;
  autoFocus?: boolean;
}

/**
 * Input numérico para cantidades. El 0 se muestra como campo vacío (no
 * escribe un "0" que haya que borrar), y nunca fuerza un mínimo mientras
 * se escribe (nada de Math.max en el onChange) — eso es lo que antes hacía
 * que el campo "saltara a 1" y no dejara borrar o escribir libremente.
 * La validación de "no puede quedar en 0" se hace aparte, al continuar.
 */
export default function QuantityInput({ value, onChange, max, className, autoFocus }: QuantityInputProps) {
  return (
    <input
      type="number"
      inputMode="numeric"
      min={0}
      max={max}
      autoFocus={autoFocus}
      className={className ?? 'input-field text-lg font-semibold'}
      value={value === 0 ? '' : value}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw === '') {
          onChange(0);
          return;
        }
        const n = Number(raw);
        onChange(Number.isNaN(n) ? 0 : n);
      }}
      placeholder="0"
    />
  );
}
