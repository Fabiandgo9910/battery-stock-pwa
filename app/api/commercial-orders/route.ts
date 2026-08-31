import { NextRequest, NextResponse } from 'next/server';
import { createRouteClient } from '@/lib/supabaseServer';
import { z } from 'zod';

const bodySchema = z.object({
  point_of_sale_id: z.string().uuid(),
  warehouse_id: z.string().uuid(),
  items: z.array(z.object({ product_model_id: z.string().uuid(), quantity: z.number().int().positive() })).min(1),
  notes: z.string().optional(),
});

// POST /api/commercial-orders -> admin/comercial SOLICITA un pedido a una
// empresa/taller. No mueve stock: el almacén tiene que darle salida.
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

    const { data, error } = await supabase.rpc('fn_create_commercial_order', {
      p_point_of_sale_id: body.point_of_sale_id,
      p_warehouse_id: body.warehouse_id,
      p_items: body.items,
      p_notes: body.notes ?? null,
    });

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ order_id: data });
  } catch (err) {
    console.error('POST /api/commercial-orders', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error inesperado al crear el pedido comercial' },
      { status: 500 }
    );
  }
}

// GET /api/commercial-orders?status=&point_of_sale_id=&from=&to=
// -> lista de pedidos comerciales (admin/almacenero/comercial), con filtros
// opcionales por estado, empresa y rango de fechas (por dispatched_at).
export async function GET(req: NextRequest) {
  try {
    const supabase = createRouteClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

    const statusParam = req.nextUrl.searchParams.get('status');
    const posParam = req.nextUrl.searchParams.get('point_of_sale_id');
    const fromParam = req.nextUrl.searchParams.get('from');
    const toParam = req.nextUrl.searchParams.get('to');

    let query = supabase
      .from('commercial_orders')
      .select(
        '*, point_of_sale:points_of_sale(id, name), requested_by_profile:profiles!commercial_orders_requested_by_fkey(full_name), dispatched_by_profile:profiles!commercial_orders_dispatched_by_fkey(full_name), commercial_order_items(id, product_model_id, quantity, product_model:product_models(brand, model_name))'
      )
      .order('created_at', { ascending: false });

    if (statusParam) query = query.eq('status', statusParam);
    if (posParam) query = query.eq('point_of_sale_id', posParam);
    if (fromParam) query = query.gte('dispatched_at', fromParam);
    if (toParam) query = query.lte('dispatched_at', toParam);

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ orders: data });
  } catch (err) {
    console.error('GET /api/commercial-orders', err);
    return NextResponse.json({ error: 'Error inesperado al listar los pedidos comerciales' }, { status: 500 });
  }
}
