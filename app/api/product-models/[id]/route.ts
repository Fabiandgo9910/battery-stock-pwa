import { NextRequest, NextResponse } from 'next/server';
import { createRouteClient } from '@/lib/supabaseServer';
import { z } from 'zod';

const updateSchema = z.object({
  brand: z.string().min(1).optional(),
  model_name: z.string().min(1).optional(),
  amperage_ah: z.number().positive().nullable().optional(),
  cold_cranking_amps: z.number().int().positive().nullable().optional(),
  battery_tech: z.enum(['normal', 'agm', 'efb']).nullable().optional(),
  is_special: z.boolean().optional(),
  special_reason: z.string().nullable().optional(),
  min_stock_alert: z.number().int().nonnegative().optional(),
});

async function requireWarehouseRole(supabase: ReturnType<typeof createRouteClient>) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { error: NextResponse.json({ error: 'No autenticado' }, { status: 401 }) };
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', session.user.id).single();
  if (!profile || !['admin', 'almacenero'].includes(profile.role)) {
    return { error: NextResponse.json({ error: 'No autorizado' }, { status: 403 }) };
  }
  return { session };
}

// PATCH /api/product-models/:id -> editar modelo (admin/almacenero)
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = createRouteClient();
    const guard = await requireWarehouseRole(supabase);
    if (guard.error) return guard.error;

    const parsed = updateSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues.map((i) => i.message).join(' · ') }, { status: 400 });
    }
    const body = parsed.data;
    if (body.is_special === false) body.special_reason = null;

    const { error } = await supabase.from('product_models').update(body).eq('id', params.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('PATCH /api/product-models/[id]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error inesperado al editar el modelo' },
      { status: 500 }
    );
  }
}

// DELETE /api/product-models/:id -> intenta borrar; si tiene movimientos/ventas
// asociados (integridad referencial), lo desactiva en su lugar (deja de
// aparecer en catálogos activos, pero conserva el histórico).
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = createRouteClient();
    const guard = await requireWarehouseRole(supabase);
    if (guard.error) return guard.error;

    const { error: deleteErr } = await supabase.from('product_models').delete().eq('id', params.id);

    if (deleteErr) {
      const { error: deactivateErr } = await supabase
        .from('product_models')
        .update({ active: false })
        .eq('id', params.id);
      if (deactivateErr) return NextResponse.json({ error: deactivateErr.message }, { status: 500 });
      return NextResponse.json({
        ok: true,
        deactivatedInstead: true,
        message: 'Este modelo ya tiene movimientos de stock o ventas registradas, así que se ha desactivado en lugar de eliminarse, para conservar el histórico.',
      });
    }

    return NextResponse.json({ ok: true, deactivatedInstead: false });
  } catch (err) {
    console.error('DELETE /api/product-models/[id]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error inesperado al eliminar el modelo' },
      { status: 500 }
    );
  }
}
