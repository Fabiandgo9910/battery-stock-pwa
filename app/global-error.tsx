'use client';

import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('Error no controlado:', error);
  }, [error]);

  return (
    <html lang="es">
      <body className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
        <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-xl">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-2xl">
            ⚠️
          </div>
          <h1 className="text-lg font-semibold text-slate-900">Algo ha ido mal</h1>
          <p className="mt-2 text-sm text-slate-500">
            Ha ocurrido un error inesperado. Puedes intentarlo de nuevo o volver al inicio.
          </p>
          <div className="mt-6 flex gap-3">
            <a href="/dashboard" className="btn-secondary flex-1">Ir al inicio</a>
            <button onClick={() => reset()} className="btn-charge flex-1">Reintentar</button>
          </div>
        </div>
      </body>
    </html>
  );
}
