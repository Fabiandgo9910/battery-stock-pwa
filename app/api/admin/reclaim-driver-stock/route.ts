import { NextRequest, NextResponse } from 'next/server';
import { createRouteClient } from '@/lib/supabaseServer';
import { z } from 'zod';

const bodySchema = z.object({
  driver_id: z.string().uuid(),
  product_model_id: z.string().uuid(),
  quantity: z.number().int().positive(),
  warehouse_id: z.string().uuid().optional(),
  notes: z.string().optional(),
});

// POST /api/admin/reclaim-driver-stock -> el admin retira stock a un
// conductor y lo devuelve al almacén central (no es una devolución de
// cliente/garantía, es una corrección/recuperación de stock).
export async function POST(req: NextRequest) {
  try {
    const supabase = createRouteClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', session.user.id).single();
    if (profile?.role !== 'admin') return NextResponse.json({ error: 'No autorizado' }, { status: 403 });

    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues.map((i) => i.message).join(' · ') }, { status: 400 });
    }
    const body = parsed.data;

    const { error } = await supabase.rpc('fn_admin_reclaim_driver_stock', {
      p_driver_id: body.driver_id,
      p_product_model_id: body.product_model_id,
      p_quantity: body.quantity,
      p_warehouse_id: body.warehouse_id ?? null,
      p_notes: body.notes ?? null,
    });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('POST /api/admin/reclaim-driver-stock', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error inesperado al retirar el stock' },
      { status: 500 }
    );
  }
}
