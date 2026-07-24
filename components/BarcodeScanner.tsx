'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';

interface BarcodeScannerProps {
  onScan: (code: string) => void;
  active: boolean;
}

/**
 * Escáner de código de barras/EAN.
 * - Usa la cámara del dispositivo (getUserMedia) vía html5-qrcode.
 * - También funciona con lectores físicos USB/Bluetooth que emulan teclado:
 *   estos "escriben" el código muy rápido seguido de Enter, así que además
 *   capturamos ese patrón a nivel de documento cuando el escáner de cámara
 *   está inactivo (por ejemplo, formularios con foco en un input oculto).
 */
export default function BarcodeScanner({ onScan, active }: BarcodeScannerProps) {
  const containerId = 'ean-scanner-viewport';
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const lastScanRef = useRef<{ code: string; time: number }>({ code: '', time: 0 });

  const handleDetected = useCallback(
    (decodedText: string) => {
      const now = Date.now();
      // Evita lecturas duplicadas repetidas en menos de 2s
      if (lastScanRef.current.code === decodedText && now - lastScanRef.current.time < 2000) {
        return;
      }
      lastScanRef.current = { code: decodedText, time: now };
      if (navigator.vibrate) navigator.vibrate(80);
      onScan(decodedText);
    },
    [onScan]
  );

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setStarting(true);
    setError(null);

    const scanner = new Html5Qrcode(containerId, {
      formatsToSupport: [
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.EAN_8,
        Html5QrcodeSupportedFormats.CODE_128,
        Html5QrcodeSupportedFormats.UPC_A,
        Html5QrcodeSupportedFormats.UPC_E,
      ],
      verbose: false,
    });
    scannerRef.current = scanner;

    scanner
      .start(
        { facingMode: 'environment' },
        { fps: 12, qrbox: { width: 280, height: 140 }, aspectRatio: 1.6 },
        (decodedText) => {
          if (!cancelled) handleDetected(decodedText);
        },
        () => {
          /* errores de "no encontrado en este frame" - se ignoran, son constantes */
        }
      )
      .then(() => setStarting(false))
      .catch((err) => {
        setStarting(false);
        setError(
          'No se pudo acceder a la cámara. Comprueba los permisos de cámara del navegador/dispositivo.'
        );
        console.error(err);
      });

    return () => {
      cancelled = true;
      if (scannerRef.current) {
        scannerRef.current
          .stop()
          .then(() => scannerRef.current?.clear())
          .catch(() => {});
      }
    };
  }, [active, handleDetected]);

  // Soporte para lectores físicos (emulan teclado): capturan input global rápido + Enter
  useEffect(() => {
    if (!active) return;
    let buffer = '';
    let lastKeyTime = 0;

    function onKeyDown(e: KeyboardEvent) {
      const now = Date.now();
      if (now - lastKeyTime > 100) buffer = ''; // reinicia si hay pausa (tecleo humano lento)
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

  if (!active) return null;

  return (
    <div className="w-full">
      <div
        id={containerId}
        className="w-full overflow-hidden rounded-2xl border-2 border-charge-400 bg-slate-950 aspect-[4/3]"
      />
      {starting && (
        <p className="mt-2 text-center text-sm text-slate-500">Iniciando cámara…</p>
      )}
      {error && (
        <p className="mt-2 text-center text-sm text-red-600">{error}</p>
      )}
      <p className="mt-2 text-center text-xs text-slate-400">
        Apunta al código EAN, o usa tu lector físico de códigos de barras.
      </p>
    </div>
  );
}
