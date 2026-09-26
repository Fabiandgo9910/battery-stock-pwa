import { NextRequest, NextResponse } from 'next/server';
import { createRouteClient } from '@/lib/supabaseServer';
import { z } from 'zod';

const bodySchema = z.object({
  warehouse_id: z.string().uuid(),
  product_model_id: z.string().uuid(),
  new_quantity: z.number().int().nonnegative(),
});

// POST /api/inventory/adjust -> fija el stock de un modelo a la cantidad
// contada físicamente (no suma, FIJA), dejando constancia del ajuste.
export async function POST(req: NextRequest) {
  try {
    const supabase = createRouteClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues.map((i) => i.message).join(' · ') }, { status: 400 });
    }
    const body = parsed.data;

    const { error } = await supabase.rpc('fn_set_warehouse_stock', {
      p_warehouse_id: body.warehouse_id,
      p_product_model_id: body.product_model_id,
      p_new_quantity: body.new_quantity,
    });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('POST /api/inventory/adjust', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error inesperado al ajustar el inventario' },
      { status: 500 }
    );
  }
}
