'use client';

import { useEffect } from 'react';

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('Error en el dashboard:', error);
  }, [error]);

  return (
    <div className="mx-auto max-w-md rounded-2xl border border-red-200 bg-red-50 p-6 text-center">
      <p className="text-sm font-medium text-red-700">
        No se ha podido cargar esta sección. Puede ser un problema temporal de conexión.
      </p>
      <button onClick={() => reset()} className="btn-secondary mt-4">
        Reintentar
      </button>
    </div>
  );
}
