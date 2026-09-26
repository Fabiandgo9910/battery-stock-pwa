import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';

const schema = z.object({ email: z.string().email() });

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error('Faltan variables de entorno NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el servidor.');
  }
  return createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

// POST /api/auth/login-status
// Ruta PÚBLICA (sin sesión) usada solo tras un fallo de inicio de sesión,
// para poder decir con precisión si la cuenta no existe, en vez del mensaje
// genérico "credenciales incorrectas". Usa el cliente de service role porque
// un usuario anónimo no tiene permiso (por RLS) para leer la tabla profiles.
export async function POST(req: NextRequest) {
  try {
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ status: 'unknown' });

    const admin = adminClient();
    const { data: profile } = await admin
      .from('profiles')
      .select('id')
      .eq('email', parsed.data.email.trim().toLowerCase())
      .maybeSingle();

    if (!profile) return NextResponse.json({ status: 'not_found' });
    return NextResponse.json({ status: 'wrong_password' });
  } catch (err) {
    console.error('POST /api/auth/login-status', err);
    // Si algo falla aquí, no bloqueamos el flujo: el login ya mostró su
    // mensaje genérico, esto es solo un extra informativo.
    return NextResponse.json({ status: 'unknown' });
  }
}
