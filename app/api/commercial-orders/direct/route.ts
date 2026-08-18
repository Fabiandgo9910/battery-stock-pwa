import { NextRequest, NextResponse } from 'next/server';
import { createRouteClient } from '@/lib/supabaseServer';
import { z } from 'zod';

const bodySchema = z.object({
  point_of_sale_id: z.string().uuid(),
  warehouse_id: z.string().uuid(),
  items: z.array(z.object({ product_model_id: z.string().uuid(), quantity: z.number().int().positive() })).min(1),
  notes: z.string().optional(),
});

// POST /api/commercial-orders/direct -> admin/almacenero: entrega directa a
// una empresa, crea el pedido y le da salida en el mismo paso (descuenta
// stock ya mismo).
export async function POST(req: NextRequest) {
  try {
    const supabase = createRouteClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', session.user.id).single();
    if (!profile || !['admin', 'almacenero'].includes(profile.role)) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
    }

    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues.map((i) => i.message).join(' · ') }, { status: 400 });
    }
    const body = parsed.data;

    const { data, error } = await supabase.rpc('fn_direct_commercial_delivery', {
      p_point_of_sale_id: body.point_of_sale_id,
      p_warehouse_id: body.warehouse_id,
      p_items: body.items,
      p_notes: body.notes ?? null,
    });

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ order_id: data });
  } catch (err) {
    console.error('POST /api/commercial-orders/direct', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error inesperado al registrar la entrega directa' },
      { status: 500 }
    );
  }
}
