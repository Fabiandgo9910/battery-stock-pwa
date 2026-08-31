import { NextRequest, NextResponse } from 'next/server';
import { createRouteClient } from '@/lib/supabaseServer';
import { z } from 'zod';

const bodySchema = z.object({
  warehouse_id: z.string().uuid(),
  driver_id: z.string().uuid(),
  product_model_id: z.string().uuid(),
  quantity: z.number().int().positive(),
  notes: z.string().optional(),
});

// POST /api/dispatch-driver -> entrega stock de almacén a un conductor
export async function POST(req: NextRequest) {
  const supabase = createRouteClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', session.user.id).single();
  if (!profile || !['admin', 'almacenero'].includes(profile.role)) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const body = parsed.data;

  const { data, error } = await supabase.rpc('fn_dispatch_to_driver', {
    p_warehouse_id: body.warehouse_id,
    p_driver_id: body.driver_id,
    p_product_model_id: body.product_model_id,
    p_quantity: body.quantity,
    p_notes: body.notes ?? null,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ delivery_id: data });
}
