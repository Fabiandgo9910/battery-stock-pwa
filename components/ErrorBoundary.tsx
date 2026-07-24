'use client';

import React from 'react';

interface Props {
  children: React.ReactNode;
  fallbackTitle?: string;
}
interface State {
  hasError: boolean;
}

/**
 * Aísla errores de un componente concreto (p. ej. el escáner de cámara,
 * que depende de APIs del navegador que pueden fallar de formas
 * impredecibles según el dispositivo) para que un fallo ahí no tumbe toda
 * la pantalla con la página genérica de error de Next.js.
 */
export default class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    // eslint-disable-next-line no-console
    console.error('Error aislado por ErrorBoundary:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-center">
          <p className="text-sm font-medium text-red-700">
            {this.props.fallbackTitle ?? 'Algo ha fallado en este componente.'}
          </p>
          <button
            onClick={() => this.setState({ hasError: false })}
            className="btn-secondary mt-3"
          >
            Reintentar
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
