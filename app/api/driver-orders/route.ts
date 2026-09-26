import { NextRequest, NextResponse } from 'next/server';
import { createRouteClient } from '@/lib/supabaseServer';
import { z } from 'zod';

const bodySchema = z.object({
  warehouse_id: z.string().uuid(),
  driver_id: z.string().uuid(),
  items: z
    .array(
      z.object({
        product_model_id: z.string().uuid(),
        quantity: z.number().int().positive(),
      })
    )
    .min(1),
  notes: z.string().optional(),
  delivery_type: z.enum(['conductor', 'ofi', 'web']).default('conductor'),
});

// POST /api/driver-orders -> crea un pedido para un conductor (admin/almacenero).
// NO mueve stock todavía: queda "pending" hasta que el conductor lo acepte.
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

    const { data, error } = await supabase.rpc('fn_create_driver_order', {
      p_warehouse_id: body.warehouse_id,
      p_driver_id: body.driver_id,
      p_items: body.items,
      p_notes: body.notes ?? null,
      p_delivery_type: body.delivery_type,
    });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Devolvemos también los codes de batería generados para poder
    // imprimirlos/etiquetarlos en el momento.
    const { data: batteryUnits } = await supabase
      .from('battery_units')
      .select('id, code, product_model_id, product_model:product_models(brand, model_name)')
      .eq('delivery_id', data)
      .order('code');

    return NextResponse.json({ delivery_id: data, battery_units: batteryUnits ?? [] });
  } catch (err) {
    console.error('POST /api/driver-orders', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error inesperado al crear el pedido' },
      { status: 500 }
    );
  }
}

// GET /api/driver-orders -> pedidos pendientes del conductor autenticado
// (admin/almacenero pueden pasar ?driver_id= para ver los de otro conductor,
// o sin parámetro para ver TODOS los pendientes de todos los conductores).
export async function GET(req: NextRequest) {
  try {
    const supabase = createRouteClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', session.user.id).single();
    const driverIdParam = req.nextUrl.searchParams.get('driver_id');
    const statusParam = req.nextUrl.searchParams.get('status'); // 'pending' | 'accepted' | 'rejected' | null (todos)

    let query = supabase
      .from('driver_deliveries')
      .select(
        '*, driver:profiles!driver_deliveries_driver_id_fkey(full_name), delivered_by_profile:profiles!driver_deliveries_delivered_by_fkey(full_name), driver_delivery_items(id, product_model_id, quantity, product_model:product_models(brand, model_name))'
      )
      .order('created_at', { ascending: false });

    if (profile?.role === 'conductor') {
      query = query.eq('driver_id', session.user.id);
    } else if (driverIdParam) {
      query = query.eq('driver_id', driverIdParam);
    }

    if (statusParam) query = query.eq('status', statusParam);

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ orders: data });
  } catch (err) {
    console.error('GET /api/driver-orders', err);
    return NextResponse.json({ error: 'Error inesperado al listar los pedidos' }, { status: 500 });
  }
}
