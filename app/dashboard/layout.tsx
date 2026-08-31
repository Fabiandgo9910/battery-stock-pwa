'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useProfile } from '@/hooks/useProfile';
import { createBrowserClient } from '@/lib/supabaseClient';
import { useState } from 'react';
import ConfirmModal from '@/components/ConfirmModal';
import PendingOrderGate from '@/components/PendingOrderGate';
import RejectedOrderAlert from '@/components/RejectedOrderAlert';

interface NavItem {
  href: string;
  label: string;
  roles: Array<'admin' | 'almacenero' | 'conductor' | 'comercial'>;
  icon: string;
}

const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', label: 'Inicio', roles: ['admin', 'almacenero', 'conductor', 'comercial'], icon: '🏠' },
  { href: '/dashboard/almacen/recepcion', label: 'Recepción', roles: ['admin', 'almacenero'], icon: '📥' },
  { href: '/dashboard/almacen/entrega-conductor', label: 'Entregar a conductor', roles: ['admin', 'almacenero'], icon: '🚚' },
  { href: '/dashboard/almacen/pedidos-pendientes', label: 'Pedidos de conductores', roles: ['admin', 'almacenero'], icon: '⏳' },
  { href: '/dashboard/pedidos-comerciales', label: 'Pedidos comerciales', roles: ['admin', 'almacenero', 'comercial'], icon: '🧾' },
  { href: '/dashboard/almacen/salidas', label: 'Salidas de almacén', roles: ['admin', 'almacenero', 'comercial'], icon: '📤' },
  { href: '/dashboard/almacen/prestamos', label: 'Préstamos', roles: ['admin', 'almacenero'], icon: '🤝' },
  { href: '/dashboard/almacen/productos', label: 'Modelos de producto', roles: ['admin', 'almacenero'], icon: '🔋' },
  { href: '/dashboard/almacen/distribuidores', label: 'Distribuidores', roles: ['admin', 'almacenero'], icon: '🏭' },
  { href: '/dashboard/almacen/venta-directa', label: 'Venta directa almacén', roles: ['admin', 'almacenero'], icon: '💶' },
  { href: '/dashboard/almacen/devoluciones', label: 'Devoluciones', roles: ['admin', 'almacenero'], icon: '↩️' },
  { href: '/dashboard/conductor/pedidos', label: 'Pedidos', roles: ['conductor'], icon: '📋' },
  { href: '/dashboard/conductor/solicitar-pedido', label: 'Solicitar pedido', roles: ['conductor'], icon: '🙋' },
  { href: '/dashboard/conductor/vender', label: 'Vender', roles: ['conductor'], icon: '💳' },
  { href: '/dashboard/conductor/mi-stock', label: 'Mi stock', roles: ['conductor'], icon: '📦' },
  { href: '/dashboard/conductor/billetera', label: 'Mi caja', roles: ['conductor'], icon: '👛' },
  { href: '/dashboard/pos', label: 'Empresas', roles: ['admin', 'almacenero', 'comercial'], icon: '🏪' },
  { href: '/dashboard/usuarios', label: 'Usuarios', roles: ['admin'], icon: '👥' },
  { href: '/dashboard/admin/billeteras', label: 'Cajas de conductores', roles: ['admin'], icon: '💰' },
  { href: '/dashboard/admin/ventas-diarias', label: 'Ventas del día', roles: ['admin'], icon: '📊' },
];

const ROLE_LABEL: Record<string, string> = {
  admin: 'Administrador',
  almacenero: 'Almacenero',
  conductor: 'Conductor / Vendedor',
  comercial: 'Comercial',
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { profile, loading } = useProfile();
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createBrowserClient();
  const [confirmLogout, setConfirmLogout] = useState(false);

  const items = profile ? NAV_ITEMS.filter((i) => i.roles.includes(profile.role)) : [];

  async function doLogout() {
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <p className="text-sm text-slate-400">Cargando…</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* Sidebar - desktop */}
      <aside className="hidden w-64 flex-col border-r border-slate-200 bg-white lg:flex">
        <div className="flex items-center gap-2 px-5 py-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-charge-400 text-slate-900 font-bold">
            SB
          </div>
          <span className="font-semibold text-slate-900">StockBat</span>
        </div>
        <nav className="flex-1 space-y-1 px-3">
          {items.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                  active ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                <span>{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-slate-100 p-4">
          <p className="text-sm font-medium text-slate-900">{profile?.full_name}</p>
          <p className="text-xs text-slate-500">{profile && ROLE_LABEL[profile.role]}</p>
          <button
            onClick={() => setConfirmLogout(true)}
            className="mt-3 w-full rounded-xl border border-slate-200 py-2 text-sm text-slate-600 hover:bg-slate-50"
          >
            Cerrar sesión
          </button>
        </div>
      </aside>

      {/* Header móvil */}
      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-charge-400 font-bold text-slate-900">
              SB
            </div>
            <span className="font-semibold">StockBat</span>
          </div>
          <button
            onClick={() => setConfirmLogout(true)}
            className="text-sm text-slate-500"
          >
            Salir
          </button>
        </header>

        <main className="flex-1 p-4 pb-24 lg:pb-4 lg:p-8">{children}</main>

        {/* Navegación inferior - móvil */}
        <nav className="fixed bottom-0 left-0 right-0 z-40 flex overflow-x-auto border-t border-slate-200 bg-white px-1 py-2 lg:hidden">
          {items.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex min-w-[76px] flex-col items-center gap-0.5 rounded-lg px-2 py-1.5 text-[11px] font-medium ${
                  active ? 'text-slate-900' : 'text-slate-400'
                }`}
              >
                <span className="text-lg">{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <ConfirmModal
        open={confirmLogout}
        title="Cerrar sesión"
        description="¿Seguro que quieres salir de tu cuenta?"
        confirmLabel="Cerrar sesión"
        tone="danger"
        onConfirm={doLogout}
        onCancel={() => setConfirmLogout(false)}
      />

      {profile?.role === 'conductor' && <PendingOrderGate />}
      {(profile?.role === 'admin' || profile?.role === 'almacenero') && <RejectedOrderAlert />}
    </div>
  );
}
