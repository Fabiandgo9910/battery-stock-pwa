import { NextRequest, NextResponse } from 'next/server';
import { createRouteClient } from '@/lib/supabaseServer';
import { z } from 'zod';

const bodySchema = z.object({
  items: z.array(z.object({ product_model_id: z.string().uuid(), quantity: z.number().int().positive() })).min(1),
  notes: z.string().optional(),
});

// POST /api/driver-orders/request -> el conductor SOLICITA un pedido (queda
// "pendiente de preparar" para el almacén; no mueve stock todavía).
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

    const { data, error } = await supabase.rpc('fn_driver_request_order', {
      p_items: body.items,
      p_notes: body.notes ?? null,
    });

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ order_id: data });
  } catch (err) {
    console.error('POST /api/driver-orders/request', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error inesperado al solicitar el pedido' },
      { status: 500 }
    );
  }
}
