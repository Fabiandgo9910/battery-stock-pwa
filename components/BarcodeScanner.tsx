'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats, Html5QrcodeScannerState } from 'html5-qrcode';

interface BarcodeScannerProps {
  onScan: (code: string) => void;
  active: boolean;
}

/**
 * Escáner de código de barras/EAN, optimizado para PWA:
 *
 * - La cámara NO se arranca sola al montar el componente: exige un toque
 *   explícito del usuario ("Activar cámara"). Esto es clave en PWA/iOS, donde
 *   el navegador puede bloquear o dar problemas con getUserMedia si no viene
 *   de un gesto directo del usuario, y es la causa más habitual de que el
 *   escáner "no funcione bien" la primera vez.
 * - El permiso de cámara del navegador solo se pide una vez por sesión de
 *   pantalla: tras el primer arranque, si `active` pasa a false se PAUSA
 *   (no se destruye) el flujo de vídeo, y si vuelve a true se REANUDA sin
 *   volver a pedir permiso ni reinicializar la cámara.
 * - Al desmontar el componente del todo (se sale de la pantalla) sí se
 *   libera la cámara por completo.
 * - También funciona con lectores físicos USB/Bluetooth que emulan teclado,
 *   sin necesidad de activar la cámara.
 */
export default function BarcodeScanner({ onScan, active }: BarcodeScannerProps) {
  const containerIdRef = useRef(`ean-scanner-${Math.random().toString(36).slice(2)}`);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const busyRef = useRef(false);
  const [phase, setPhase] = useState<'idle' | 'starting' | 'running' | 'paused' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [justDetected, setJustDetected] = useState(false);
  const lastScanRef = useRef<{ code: string; time: number }>({ code: '', time: 0 });

  const handleDetected = useCallback(
    (decodedText: string) => {
      const now = Date.now();
      if (lastScanRef.current.code === decodedText && now - lastScanRef.current.time < 2000) {
        return;
      }
      lastScanRef.current = { code: decodedText, time: now };
      // Feedback instantáneo (vibración + flash visual) ANTES de que el
      // padre haga cualquier búsqueda async: así el escaneo en sí se percibe
      // rápido incluso si buscar el modelo tarda un poco.
      if (navigator.vibrate) navigator.vibrate(80);
      setJustDetected(true);
      setTimeout(() => setJustDetected(false), 500);
      onScan(decodedText);
    },
    [onScan]
  );

  // Arranque explícito (gesto del usuario): pide permiso y abre la cámara.
  const startCamera = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setError(null);
    setPhase('starting');
    try {
      if (!scannerRef.current) {
        scannerRef.current = new Html5Qrcode(containerIdRef.current, {
          formatsToSupport: [
            Html5QrcodeSupportedFormats.EAN_13,
            Html5QrcodeSupportedFormats.EAN_8,
            Html5QrcodeSupportedFormats.CODE_128,
            Html5QrcodeSupportedFormats.UPC_A,
            Html5QrcodeSupportedFormats.UPC_E,
          ],
          verbose: false,
          // Usa la API nativa BarcodeDetector del navegador cuando está
          // disponible (Chrome/Android): decodifica mucho más rápido que el
          // decodificador en JS puro, que se usa como respaldo automático.
          useBarCodeDetectorIfSupported: true,
        });
      }
      await scannerRef.current.start(
        { facingMode: 'environment' },
        {
          fps: 24,
          qrbox: { width: 300, height: 150 },
          aspectRatio: 1.6,
          disableFlip: false,
        },
        (decodedText) => handleDetected(decodedText),
        () => {
          /* "no encontrado en este frame" - se ignora, es constante */
        }
      );
      setPhase('running');
    } catch (err) {
      console.error(err);
      setPhase('error');
      setError(
        'No se pudo acceder a la cámara. Comprueba los permisos de cámara del navegador/dispositivo.'
      );
    } finally {
      busyRef.current = false;
    }
  }, [handleDetected]);

  // Pausa / reanuda automáticamente según `active`, SIN volver a pedir
  // permiso ni reinicializar el vídeo (solo si ya se arrancó antes).
  useEffect(() => {
    if (busyRef.current) return;
    const scanner = scannerRef.current;
    if (!scanner) return;

    let state: number;
    try {
      state = scanner.getState();
    } catch {
      return;
    }

    async function toggle() {
      busyRef.current = true;
      try {
        if (active && state === Html5QrcodeScannerState.PAUSED) {
          scanner!.resume();
          setPhase('running');
        } else if (!active && state === Html5QrcodeScannerState.SCANNING) {
          scanner!.pause(true);
          setPhase('paused');
        }
      } catch (err) {
        console.error(err);
      } finally {
        busyRef.current = false;
      }
    }
    toggle();
  }, [active]);

  // Al desmontar del todo (se abandona la pantalla), liberamos la cámara.
  useEffect(() => {
    return () => {
      const s = scannerRef.current;
      if (!s) return;
      try {
        const state = s.getState();
        if (state === Html5QrcodeScannerState.SCANNING || state === Html5QrcodeScannerState.PAUSED) {
          s.stop()
            .then(() => s.clear())
            .catch(() => {
              try {
                s.clear();
              } catch {
                /* el nodo del DOM ya pudo haberse desmontado */
              }
            });
        } else {
          try {
            s.clear();
          } catch {
            /* noop */
          }
        }
      } catch {
        /* noop */
      }
      scannerRef.current = null;
    };
  }, []);

  // Soporte para lectores físicos (emulan teclado): capturan input global
  // rápido + Enter. Solo mientras esta pantalla quiere escanear.
  useEffect(() => {
    if (!active) return;
    let buffer = '';
    let lastKeyTime = 0;

    function onKeyDown(e: KeyboardEvent) {
      const now = Date.now();
      if (now - lastKeyTime > 100) buffer = '';
      lastKeyTime = now;

      if (e.key === 'Enter') {
        if (buffer.length >= 6) handleDetected(buffer);
        buffer = '';
        return;
      }
      if (e.key.length === 1) buffer += e.key;
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active, handleDetected]);

  if (!active && phase === 'idle') return null;

  return (
    <div className="w-full">
      <div className="relative w-full overflow-hidden rounded-2xl border-2 border-charge-400 bg-slate-950 aspect-[4/3]">
        <div id={containerIdRef.current} className="h-full w-full" />

        {justDetected && (
          <div className="absolute inset-0 flex items-center justify-center bg-charge-400/30 pointer-events-none">
            <span className="rounded-full bg-charge-400 px-4 py-2 text-lg font-bold text-slate-900 shadow-lg">
              ✓ Detectado
            </span>
          </div>
        )}

        {phase !== 'running' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-950/90 px-6 text-center">
            {phase === 'starting' ? (
              <p className="text-sm text-slate-300">Iniciando cámara…</p>
            ) : phase === 'paused' ? (
              <p className="text-sm text-slate-300">Cámara en pausa</p>
            ) : (
              <>
                <span className="text-4xl">📷</span>
                <button
                  type="button"
                  onClick={startCamera}
                  className="rounded-xl bg-charge-400 px-5 py-2.5 text-sm font-semibold text-slate-900 hover:bg-charge-500"
                >
                  {phase === 'error' ? 'Reintentar' : 'Activar cámara'}
                </button>
                <p className="max-w-[220px] text-xs text-slate-400">
                  El navegador te pedirá permiso de cámara la primera vez.
                </p>
              </>
            )}
          </div>
        )}
      </div>

      {error && <p className="mt-2 text-center text-sm text-red-600">{error}</p>}
      <p className="mt-2 text-center text-xs text-slate-400">
        Apunta al código EAN, o usa tu lector físico de códigos de barras.
      </p>
    </div>
  );
}
