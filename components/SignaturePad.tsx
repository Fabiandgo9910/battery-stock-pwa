'use client';

import { useEffect, useRef, useState } from 'react';

interface SignaturePadProps {
  onChange: (dataUrl: string | null) => void;
  height?: number;
}

/**
 * Panel de firma táctil: funciona igual con el dedo en la pantalla de un
 * móvil/tablet que con un panel táctil de firmas USB (que el sistema trata
 * como un ratón/puntero más), o con un lápiz óptico. Exporta la firma como
 * PNG en base64 (data URL) a través de onChange.
 */
export default function SignaturePad({ onChange, height = 180 }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const hasStroke = useRef(false);
  const lastPoint = useRef<{ x: number; y: number } | null>(null);
  const [empty, setEmpty] = useState(true);

  function getContext() {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    return canvas.getContext('2d');
  }

  // Ajusta el canvas a su tamaño real en pantalla (con devicePixelRatio) para
  // que el trazo no salga borroso ni desalineado del dedo/puntero.
  function resizeCanvas() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const prev = !empty ? canvas.toDataURL() : null;
    canvas.width = rect.width * ratio;
    canvas.height = rect.height * ratio;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.scale(ratio, ratio);
      ctx.lineWidth = 2.2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#0f172a';
    }
    if (prev) {
      const img = new Image();
      img.onload = () => ctx?.drawImage(img, 0, 0, rect.width, rect.height);
      img.src = prev;
    }
  }

  useEffect(() => {
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    return () => window.removeEventListener('resize', resizeCanvas);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pointFromEvent(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    e.preventDefault();
    const canvas = canvasRef.current;
    canvas?.setPointerCapture(e.pointerId);
    drawing.current = true;
    lastPoint.current = pointFromEvent(e);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    e.preventDefault();
    const ctx = getContext();
    const point = pointFromEvent(e);
    if (ctx && lastPoint.current) {
      ctx.beginPath();
      ctx.moveTo(lastPoint.current.x, lastPoint.current.y);
      ctx.lineTo(point.x, point.y);
      ctx.stroke();
      hasStroke.current = true;
    }
    lastPoint.current = point;
  }

  function finishStroke() {
    drawing.current = false;
    lastPoint.current = null;
    if (hasStroke.current) {
      setEmpty(false);
      const canvas = canvasRef.current;
      onChange(canvas ? canvas.toDataURL('image/png') : null);
    }
  }

  function clear() {
    const canvas = canvasRef.current;
    const ctx = getContext();
    if (canvas && ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    hasStroke.current = false;
    setEmpty(true);
    onChange(null);
  }

  return (
    <div>
      <div
        className="rounded-xl border-2 border-dashed border-slate-300 bg-white touch-none"
        style={{ height }}
      >
        <canvas
          ref={canvasRef}
          className="h-full w-full touch-none"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishStroke}
          onPointerLeave={finishStroke}
          onPointerCancel={finishStroke}
        />
      </div>
      <div className="mt-2 flex items-center justify-between">
        <p className="text-xs text-slate-400">
          {empty ? 'Firma aquí con el dedo, un lápiz óptico o un panel de firmas.' : 'Firma capturada.'}
        </p>
        <button type="button" className="text-xs text-slate-400 underline" onClick={clear}>
          Borrar y repetir
        </button>
      </div>
    </div>
  );
}
