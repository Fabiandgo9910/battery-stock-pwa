import { NextRequest, NextResponse } from 'next/server';
import { createRouteClient } from '@/lib/supabaseServer';
import { z } from 'zod';

const bodySchema = z.object({
  warehouse_id: z.string().uuid(),
  point_of_sale_id: z.string().uuid(),
  items: z
    .array(
      z.object({
        product_model_id: z.string().uuid(),
        ean_code: z.string().optional(),
        quantity: z.number().int().positive(),
      })
    )
    .min(1),
});

// POST /api/commercial-sale -> venta comercial (admin/almacenero/comercial),
// genera factura en borrador (precio en blanco)
export async function POST(req: NextRequest) {
  try {
    const supabase = createRouteClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues.map((i) => i.message).join(' · ') }, { status: 400 });
    }
    const body = parsed.data;

    const { data, error } = await supabase.rpc('fn_commercial_sale', {
      p_seller_id: session.user.id,
      p_warehouse_id: body.warehouse_id,
      p_point_of_sale_id: body.point_of_sale_id,
      p_items: body.items,
    });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ invoice_id: data });
  } catch (err) {
    console.error('POST /api/commercial-sale', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error inesperado al registrar la venta comercial' },
      { status: 500 }
    );
  }
}
