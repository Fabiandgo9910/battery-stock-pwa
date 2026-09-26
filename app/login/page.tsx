'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserClient } from '@/lib/supabaseClient';
import toast from 'react-hot-toast';

export default function LoginPage() {
  const router = useRouter();
  const supabase = createBrowserClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (!error) {
      setLoading(false);
      toast.success('Bienvenido');
      router.push('/dashboard');
      router.refresh();
      return;
    }

    // Login falló: averiguamos el motivo exacto (no existe / desactivado /
    // contraseña incorrecta) para dar un mensaje preciso en vez del genérico.
    try {
      const res = await fetch('/api/auth/login-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const json = await res.json();
      if (json.status === 'not_found') {
        toast.error('No existe ninguna cuenta con ese correo.');
      } else if (json.status === 'wrong_password') {
        toast.error('Contraseña incorrecta.');
      } else {
        toast.error('No se pudo iniciar sesión. Inténtalo de nuevo.');
      }
    } catch {
      toast.error('Credenciales incorrectas.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-2">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-charge-400">
            <svg viewBox="0 0 24 24" className="h-7 w-7 text-slate-900" fill="currentColor">
              <path d="M17 5h-1V4a1 1 0 00-1-1H9a1 1 0 00-1 1v1H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2zM10 5h4v1h-4V5zm3 10.5l-3 4v-3H9l3-4v3h1z"/>
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-white">StockBat</h1>
          <p className="text-sm text-slate-400">Accede a tu cuenta para continuar</p>
        </div>

        <form onSubmit={handleSubmit} className="rounded-2xl bg-white p-6 shadow-xl">
          <div className="mb-4">
            <label className="label-field">Correo electrónico</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input-field"
              placeholder="tucorreo@empresa.com"
              autoComplete="email"
            />
          </div>
          <div className="mb-6">
            <label className="label-field">Contraseña</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input-field"
              placeholder="••••••••"
              autoComplete="current-password"
            />
          </div>
          <button type="submit" disabled={loading} className="btn-charge w-full">
            {loading ? 'Entrando…' : 'Iniciar sesión'}
          </button>
        </form>
        <p className="mt-6 text-center text-xs text-slate-500">
          ¿No tienes cuenta? Pide a un administrador que te dé de alta.
        </p>
      </div>
    </main>
  );
}
