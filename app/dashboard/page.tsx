'use client';

import { useProfile } from '@/hooks/useProfile';

export default function DashboardHome() {
  const { profile } = useProfile();

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
