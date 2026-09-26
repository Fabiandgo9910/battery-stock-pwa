'use client';

import { useEffect, useState } from 'react';
import { useProfile } from '@/hooks/useProfile';
import DateRangeFilter from '@/components/DateRangeFilter';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts';

function toISO(d: Date) {
  return d.toISOString().slice(0, 10);
}
function defaultRange() {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 29);
  return { from: toISO(start), to: toISO(end) };
}

const PIE_COLORS = ['#0ea5e9', '#f59e0b', '#10b981', '#6366f1'];

interface AdminStats {
  byDriver: { name: string; units: number }[];
  topModels: { name: string; units: number }[];
  byCompany: { name: string; units: number }[];
  byOrigin: { particular: number; web: number; mapfre: number };
  warrantyCount: number;
  warehouseDirectCount: number;
  warehouseDirectUnits: number;
}
interface ConductorStats {
  total: number;
  warranty: number;
  byOrigin: { particular: number; web: number; mapfre: number };
}

function AdminDashboard() {
  const [range, setRange] = useState(defaultRange());
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/admin/stats?from=${range.from}&to=${range.to}`)
      .then((r) => r.json())
      .then((json) => setStats(json))
      .finally(() => setLoading(false));
  }, [range]);

  const originData = stats
    ? [
        { name: 'Particular', value: stats.byOrigin.particular },
        { name: 'Web', value: stats.byOrigin.web },
        { name: 'Mapfre', value: stats.byOrigin.mapfre },
      ].filter((d) => d.value > 0)
    : [];

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-slate-900">Resumen</h1>
        <DateRangeFilter from={range.from} to={range.to} onChange={(from, to) => setRange({ from, to })} />
      </div>

      {loading && <p className="mt-6 text-sm text-slate-400">Cargando estadísticas…</p>}

      {stats && (
        <>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="card text-center">
              <p className="text-xs uppercase text-slate-400">Garantías puestas</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{stats.warrantyCount}</p>
            </div>
            <div className="card text-center">
              <p className="text-xs uppercase text-slate-400">Ventas directas almacén</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{stats.warehouseDirectCount}</p>
              <p className="text-xs text-slate-400">{stats.warehouseDirectUnits} uds.</p>
            </div>
            <div className="card text-center">
              <p className="text-xs uppercase text-slate-400">Uds. vendidas WEB</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{stats.byOrigin.web}</p>
            </div>
            <div className="card text-center">
              <p className="text-xs uppercase text-slate-400">Uds. vendidas Mapfre</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{stats.byOrigin.mapfre}</p>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="card">
              <h2 className="text-sm font-semibold text-slate-700">Baterías vendidas por conductor</h2>
              <div className="mt-3 h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={stats.byDriver} layout="vertical" margin={{ left: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" allowDecimals={false} />
                    <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="units" fill="#0ea5e9" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="card">
              <h2 className="text-sm font-semibold text-slate-700">Baterías más vendidas</h2>
              <div className="mt-3 h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={stats.topModels} layout="vertical" margin={{ left: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" allowDecimals={false} />
                    <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="units" fill="#10b981" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="card">
              <h2 className="text-sm font-semibold text-slate-700">Baterías por origen de venta</h2>
              <div className="mt-3 h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={originData} dataKey="value" nameKey="name" outerRadius={90} label>
                      {originData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    </Pie>
                    <Legend />
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="card">
              <h2 className="text-sm font-semibold text-slate-700">Baterías por empresa comercial</h2>
              <div className="mt-3 h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={stats.byCompany} layout="vertical" margin={{ left: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" allowDecimals={false} />
                    <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="units" fill="#f59e0b" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function ConductorDashboard({ name }: { name: string }) {
  const [range, setRange] = useState(defaultRange());
  const [stats, setStats] = useState<ConductorStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/conductor/stats?from=${range.from}&to=${range.to}`)
      .then((r) => r.json())
      .then((json) => setStats(json))
      .finally(() => setLoading(false));
  }, [range]);

  return (
    <div>
      <h1 className="text-2xl font-semibold text-slate-900">Hola, {name}</h1>
      <div className="mt-4">
        <DateRangeFilter from={range.from} to={range.to} onChange={(from, to) => setRange({ from, to })} />
      </div>

      {loading && <p className="mt-6 text-sm text-slate-400">Cargando…</p>}

      {stats && (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="card text-center">
            <p className="text-xs uppercase text-slate-400">Baterías vendidas</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{stats.total}</p>
          </div>
          <div className="card text-center">
            <p className="text-xs uppercase text-slate-400">Web</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{stats.byOrigin.web}</p>
          </div>
          <div className="card text-center">
            <p className="text-xs uppercase text-slate-400">Mapfre</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{stats.byOrigin.mapfre}</p>
          </div>
          <div className="card text-center">
            <p className="text-xs uppercase text-slate-400">Garantías</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{stats.warranty}</p>
          </div>
        </div>
      )}
    </div>
  );
}

export default function DashboardHome() {
  const { profile } = useProfile();

  if (profile?.role === 'admin') return <AdminDashboard />;
  if (profile?.role === 'conductor') return <ConductorDashboard name={profile.full_name?.split(' ')[0] ?? ''} />;

  return (
    <div>
      <h1 className="text-2xl font-semibold text-slate-900">
        Hola, {profile?.full_name?.split(' ')[0] ?? ''}
      </h1>
      <p className="mt-1 text-slate-500">
        Usa el menú para escanear recepciones, entregar stock a conductores, vender o
        gestionar ventas comerciales.
      </p>

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="card">
          <p className="text-sm text-slate-500">Rol activo</p>
          <p className="mt-1 text-lg font-semibold capitalize">{profile?.role}</p>
        </div>
        <div className="card">
          <p className="text-sm text-slate-500">Cuenta</p>
          <p className="mt-1 text-lg font-semibold">{profile?.email}</p>
        </div>
      </div>
    </div>
  );
}
