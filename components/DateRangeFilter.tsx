'use client';

function toISO(d: Date) {
  return d.toISOString().slice(0, 10);
}

interface DateRangeFilterProps {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
}

export default function DateRangeFilter({ from, to, onChange }: DateRangeFilterProps) {
  function setPreset(days: number) {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - (days - 1));
    onChange(toISO(start), toISO(end));
  }
  function setThisMonth() {
    const now = new Date();
    onChange(toISO(new Date(now.getFullYear(), now.getMonth(), 1)), toISO(now));
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button className="btn-secondary text-xs" onClick={() => setPreset(1)}>Hoy</button>
      <button className="btn-secondary text-xs" onClick={() => setPreset(7)}>7 días</button>
      <button className="btn-secondary text-xs" onClick={() => setPreset(30)}>30 días</button>
      <button className="btn-secondary text-xs" onClick={setThisMonth}>Este mes</button>
      <input type="date" className="input-field !w-auto" value={from} onChange={(e) => onChange(e.target.value, to)} />
      <span className="text-slate-400">a</span>
      <input type="date" className="input-field !w-auto" value={to} onChange={(e) => onChange(from, e.target.value)} />
    </div>
  );
}
