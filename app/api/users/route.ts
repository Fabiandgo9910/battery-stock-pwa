import { NextRequest, NextResponse } from 'next/server';
import { createRouteClient } from '@/lib/supabaseServer';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';

const createSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  full_name: z.string().min(1),
  role: z.enum(['admin', 'almacenero', 'conductor', 'comercial']),
  phone: z.string().optional(),
  vehicle_plate: z.string().optional(),
  zone: z.string().optional(),
  driver_code: z.string().optional(),
});

// Cliente admin (service role) SOLO se usa server-side, nunca se expone al navegador.
// Desactivamos autoRefreshToken/persistSession porque en un Route Handler no hay
// almacenamiento de sesión de navegador (evita errores silenciosos server-side).
function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      'Faltan variables de entorno NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el servidor.'
    );
  }
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// GET /api/users -> lista de usuarios (solo admin)
export async function GET() {
  try {
    const supabase = createRouteClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', session.user.id).single();
    if (profile?.role !== 'admin') return NextResponse.json({ error: 'No autorizado' }, { status: 403 });

    const { data, error } = await supabase.from('profiles').select('*').order('full_name');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ users: data });
  } catch (err) {
    console.error('GET /api/users', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error inesperado al listar usuarios' },
      { status: 500 }
    );
  }
}

// POST /api/users -> crea usuario en Auth + su perfil (solo admin)
export async function POST(req: NextRequest) {
  let createdAuthUserId: string | null = null;
  try {
    const supabase = createRouteClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', session.user.id).single();
    if (profile?.role !== 'admin') return NextResponse.json({ error: 'No autorizado' }, { status: 403 });

    const json = await req.json().catch(() => null);
    const parsed = createSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues.map((i) => i.message).join(' · ') }, { status: 400 });
    }
    const body = parsed.data;

    const admin = adminClient();

    // 1) Crear el usuario en Supabase Auth
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: body.email,
      password: body.password,
      email_confirm: true,
    });

    if (createErr || !created.user) {
      // Errores típicos aquí: email ya registrado, contraseña débil, etc.
      return NextResponse.json(
        { error: createErr?.message ?? 'No se pudo crear el usuario en el sistema de autenticación' },
        { status: 400 }
      );
    }
    createdAuthUserId = created.user.id;

    // 2) Crear su perfil (con service role para saltar RLS de forma controlada)
    const { error: profileErr } = await admin.from('profiles').insert({
      id: created.user.id,
      full_name: body.full_name,
      email: body.email,
      role: body.role,
      phone: body.phone || null,
      vehicle_plate: body.role === 'conductor' ? body.vehicle_plate || null : null,
      zone: body.role === 'conductor' ? body.zone || null : null,
      driver_code: body.role === 'conductor' ? body.driver_code?.toUpperCase() || null : null,
    });

    if (profileErr) {
      // Si el perfil falla, deshacemos el usuario de Auth para no dejar huérfanos
      await admin.auth.admin.deleteUser(created.user.id).catch(() => {});
      const message = profileErr.message.includes('idx_profiles_driver_code')
        ? 'Ese código de conductor ya lo tiene otro conductor. Elige uno distinto.'
        : `Error al crear el perfil: ${profileErr.message}`;
      return NextResponse.json({ error: message }, { status: 500 });
    }

    // 3) Si es conductor, crea su billetera con saldos a 0
    if (body.role === 'conductor') {
      const { error: walletErr } = await admin
        .from('driver_wallets')
        .insert({ driver_id: created.user.id, cash_balance: 0, card_balance: 0 });
      if (walletErr) {
        console.error('No se pudo crear la billetera del conductor:', walletErr.message);
        // No revertimos el usuario por esto: el admin puede reintentar la creación
        // de la billetera; el usuario y su perfil ya son válidos.
      }
    }

    return NextResponse.json({ user_id: created.user.id });
  } catch (err) {
    console.error('POST /api/users', err);
    // Si llegamos a crear el usuario de Auth pero algo posterior explotó, lo revertimos.
    if (createdAuthUserId) {
      try {
        const admin = adminClient();
        await admin.auth.admin.deleteUser(createdAuthUserId);
      } catch {
        /* si ni esto funciona, quedará un usuario huérfano en Auth para revisar manualmente */
      }
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error inesperado al crear el usuario' },
      { status: 500 }
    );
  }
}
