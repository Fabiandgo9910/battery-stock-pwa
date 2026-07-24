import { NextRequest, NextResponse } from 'next/server';
import { createRouteClient } from '@/lib/supabaseServer';

async function requireCommercialOrAdmin(supabase: ReturnType<typeof createRouteClient>) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { error: NextResponse.json({ error: 'No autenticado' }, { status: 401 }) };

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', session.user.id).single();
  if (!profile || !['admin', 'comercial'].includes(profile.role)) {
    return { error: NextResponse.json({ error: 'No autorizado' }, { status: 403 }) };
  }
  return { session };
}

// PATCH /api/points-of-sale/:id -> editar
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = createRouteClient();
    const guard = await requireCommercialOrAdmin(supabase);
    if (guard.error) return guard.error;

    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: 'Cuerpo de la petición inválido' }, { status: 400 });

    const { error } = await supabase.from('points_of_sale').update(body).eq('id', params.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('PATCH /api/points-of-sale/[id]', err);
    return NextResponse.json({ error: 'Error inesperado al editar el punto de venta' }, { status: 500 });
  }
}

// DELETE /api/points-of-sale/:id -> intenta eliminar físicamente.
// Si tiene ventas/facturas asociadas y la base de datos aún no tiene aplicada
// la migración 002 (que pone esas referencias a NULL en vez de bloquear el
// borrado), se desactiva en su lugar para no perder el histórico.
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = createRouteClient();
    const guard = await requireCommercialOrAdmin(supabase);
    if (guard.error) return guard.error;

    const { error: deleteErr } = await supabase.from('points_of_sale').delete().eq('id', params.id);

    if (deleteErr) {
      const { error: deactivateErr } = await supabase
        .from('points_of_sale')
        .update({ active: false })
        .eq('id', params.id);
      if (deactivateErr) return NextResponse.json({ error: deactivateErr.message }, { status: 500 });
      return NextResponse.json({
        ok: true,
        deactivatedInstead: true,
        message: 'Este punto de venta tiene ventas o facturas asociadas, así que se ha desactivado en lugar de eliminarse, para conservar el histórico.',
      });
    }

    return NextResponse.json({ ok: true, deactivatedInstead: false });
  } catch (err) {
    console.error('DELETE /api/points-of-sale/[id]', err);
    return NextResponse.json({ error: 'Error inesperado al eliminar el punto de venta' }, { status: 500 });
  }
}
