import { NextRequest, NextResponse } from 'next/server';
import { createRouteClient } from '@/lib/supabaseServer';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';

const updateSchema = z.object({
  full_name: z.string().min(1).optional(),
  role: z.enum(['admin', 'almacenero', 'conductor', 'comercial']).optional(),
  phone: z.string().optional(),
  vehicle_plate: z.string().optional(),
  zone: z.string().optional(),
  active: z.boolean().optional(),
});

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error('Faltan variables de entorno NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el servidor.');
  }
  return createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function requireAdmin(supabase: ReturnType<typeof createRouteClient>) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { error: NextResponse.json({ error: 'No autenticado' }, { status: 401 }) };
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', session.user.id).single();
  if (profile?.role !== 'admin') return { error: NextResponse.json({ error: 'No autorizado' }, { status: 403 }) };
  return { session };
}

// PATCH /api/users/:id -> editar usuario (solo admin)
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = createRouteClient();
    const guard = await requireAdmin(supabase);
    if (guard.error) return guard.error;

    const parsed = updateSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues.map((i) => i.message).join(' · ') }, { status: 400 });
    }

    const { error } = await supabase.from('profiles').update(parsed.data).eq('id', params.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('PATCH /api/users/[id]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error inesperado al editar el usuario' },
      { status: 500 }
    );
  }
}

// DELETE /api/users/:id -> por defecto DESACTIVA (soft delete, conserva trazabilidad).
// DELETE /api/users/:id?permanent=true -> ELIMINA de verdad (Auth + perfil).
// Se recomienda usar el borrado permanente solo si el usuario nunca llegó a
// operar en el sistema (si tiene ventas/entregas registradas, el borrado
// físico fallará por integridad referencial y se avisa al admin).
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = createRouteClient();
    const guard = await requireAdmin(supabase);
    if (guard.error) return guard.error;

    const permanent = req.nextUrl.searchParams.get('permanent') === 'true';

    if (!permanent) {
      const { error } = await supabase.from('profiles').update({ active: false }).eq('id', params.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true, deleted: false });
    }

    // Borrado permanente: requiere el cliente con service role para tocar Auth.
    const admin = adminClient();
    const { error: authErr } = await admin.auth.admin.deleteUser(params.id);

    if (authErr) {
      // Si falla (p. ej. porque tiene ventas/entregas asociadas y algo bloquea
      // el borrado en cascada), lo dejamos desactivado en su lugar.
      await supabase.from('profiles').update({ active: false }).eq('id', params.id);
      return NextResponse.json({
        ok: true,
        deleted: false,
        message: 'No se pudo eliminar por completo (tiene historial asociado), así que se ha desactivado en su lugar.',
      });
    }

    return NextResponse.json({ ok: true, deleted: true });
  } catch (err) {
    console.error('DELETE /api/users/[id]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error inesperado al eliminar el usuario' },
      { status: 500 }
    );
  }
}
