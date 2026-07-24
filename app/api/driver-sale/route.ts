import { NextRequest, NextResponse } from 'next/server';
import { createRouteClient } from '@/lib/supabaseServer';
import { z } from 'zod';

const bodySchema = z.object({
  product_model_id: z.string().uuid(),
  ean_code: z.string().optional(),
  quantity: z.number().int().positive(),
  amount_cash: z.number().nonnegative(),
  amount_card: z.number().nonnegative(),
  notes: z.string().optional(),
});

// POST /api/driver-sale -> venta unitaria de un conductor (resta su stock, suma su billetera)
export async function POST(req: NextRequest) {
  const supabase = createRouteClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const body = parsed.data;

  const { data, error } = await supabase.rpc('fn_driver_sale', {
    p_driver_id: session.user.id,
    p_product_model_id: body.product_model_id,
    p_ean_code: body.ean_code ?? null,
    p_quantity: body.quantity,
    p_amount_cash: body.amount_cash,
    p_amount_card: body.amount_card,
    p_notes: body.notes ?? null,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ sale_id: data });
}
