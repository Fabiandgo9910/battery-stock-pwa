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
});

// Cliente admin (service role) SOLO se usa server-side, nunca se expone al navegador
function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// GET /api/users -> lista de usuarios (solo admin)
export async function GET() {
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
}

// POST /api/users -> crea usuario en Auth + su perfil (solo admin)
export async function POST(req: NextRequest) {
  const supabase = createRouteClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', session.user.id).single();
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'No autorizado' }, { status: 403 });

  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const body = parsed.data;

  const admin = adminClient();
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: body.email,
    password: body.password,
    email_confirm: true,
  });

  if (createErr || !created.user) {
    return NextResponse.json({ error: createErr?.message ?? 'Error creando usuario' }, { status: 500 });
  }

  const { error: profileErr } = await admin.from('profiles').insert({
    id: created.user.id,
    full_name: body.full_name,
    email: body.email,
    role: body.role,
    phone: body.phone ?? null,
    vehicle_plate: body.vehicle_plate ?? null,
    zone: body.zone ?? null,
  });

  if (profileErr) return NextResponse.json({ error: profileErr.message }, { status: 500 });

  if (body.role === 'conductor') {
    await admin.from('driver_wallets').insert({ driver_id: created.user.id });
  }

  return NextResponse.json({ user_id: created.user.id });
}
