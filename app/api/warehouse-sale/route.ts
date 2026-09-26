import { NextRequest, NextResponse } from 'next/server';
import { createRouteClient } from '@/lib/supabaseServer';
import { z } from 'zod';

const bodySchema = z.object({
  warehouse_id: z.string().uuid(),
  product_model_id: z.string().uuid(),
  ean_code: z.string().optional(),
  quantity: z.number().int().positive(),
  amount_cash: z.number().nonnegative(),
  amount_card: z.number().nonnegative(),
  is_warranty: z.boolean().default(false),
  customer_vehicle_plate: z.string().optional(),
  old_battery_returned: z.boolean().optional(),
  old_battery_reason: z.string().optional(),
  sale_origin: z.enum(['particular', 'web', 'mapfre']).default('particular'),
  notes: z.string().optional(),
  customer_vehicle_model: z.string().optional(),
  battery_code: z.string().optional(),
});

// POST /api/warehouse-sale -> venta directa del almacenero/admin desde el
// almacén central. Funciona igual que una venta de conductor (misma lógica
// de garantía, efectivo/tarjeta, matrícula, batería vieja, origen), pero no
// tiene nada que ver con la venta comercial (esa es para empresas/talleres
// por transferencia y con factura).
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

    const { data, error } = await supabase.rpc('fn_warehouse_sale', {
      p_seller_id: session.user.id,
      p_warehouse_id: body.warehouse_id,
      p_product_model_id: body.product_model_id,
      p_ean_code: body.ean_code ?? null,
      p_quantity: body.quantity,
      p_amount_cash: body.amount_cash,
      p_amount_card: body.amount_card,
      p_is_warranty: body.is_warranty,
      p_customer_vehicle_plate: body.customer_vehicle_plate ?? null,
      p_old_battery_returned: body.old_battery_returned ?? null,
      p_old_battery_reason: body.old_battery_reason ?? null,
      p_sale_origin: body.sale_origin,
      p_notes: body.notes ?? null,
      p_customer_vehicle_model: body.customer_vehicle_model ?? null,
      p_battery_code: body.battery_code ?? null,
    });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ sale_id: data });
  } catch (err) {
    console.error('POST /api/warehouse-sale', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error inesperado al registrar la venta' },
      { status: 500 }
    );
  }
}
