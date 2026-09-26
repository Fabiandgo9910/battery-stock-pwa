import { NextRequest, NextResponse } from 'next/server';
import { createRouteClient } from '@/lib/supabaseServer';

// GET /api/admin/stats?from=YYYY-MM-DD&to=YYYY-MM-DD
// Estadísticas para el panel de inicio del admin: baterías vendidas por
// conductor, garantías, ventas directas de almacén, más vendidas, origen
// (web/mapfre/particular) y cuánto se ha llevado cada empresa comercial.
export async function GET(req: NextRequest) {
  try {
    const supabase = createRouteClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', session.user.id).single();
    if (profile?.role !== 'admin') return NextResponse.json({ error: 'No autorizado' }, { status: 403 });

    const fromParam = req.nextUrl.searchParams.get('from');
    const toParam = req.nextUrl.searchParams.get('to');
    if (!fromParam || !toParam) {
      return NextResponse.json({ error: 'Indica el rango de fechas (from/to)' }, { status: 400 });
    }
    const from = new Date(fromParam);
    from.setHours(0, 0, 0, 0);
    const to = new Date(toParam);
    to.setHours(23, 59, 59, 999);

    const { data: sales, error: salesErr } = await supabase
      .from('sales')
      .select(
        `id, sale_channel, is_warranty, sale_origin, seller_id,
         seller:profiles(full_name),
         sale_items(quantity, product_model:product_models(brand, model_name))`
      )
      .gte('sold_at', from.toISOString())
      .lte('sold_at', to.toISOString());

    if (salesErr) return NextResponse.json({ error: salesErr.message }, { status: 500 });

    const byDriver = new Map<string, { name: string; units: number }>();
    const byModel = new Map<string, { name: string; units: number }>();
    let warrantyCount = 0;
    let warehouseDirectCount = 0;
    let warehouseDirectUnits = 0;
    const byOrigin = { particular: 0, web: 0, mapfre: 0 };

    for (const sale of sales ?? []) {
      const units = (sale.sale_items ?? []).reduce((sum: number, i: any) => sum + i.quantity, 0);
      if (sale.is_warranty) warrantyCount += 1;
      if (sale.sale_channel === 'warehouse_direct') {
        warehouseDirectCount += 1;
        warehouseDirectUnits += units;
      }
      const origin = (sale.sale_origin as 'particular' | 'web' | 'mapfre') ?? 'particular';
      byOrigin[origin] = (byOrigin[origin] ?? 0) + units;

      if (sale.sale_channel === 'driver') {
        const key = sale.seller_id ?? 'desconocido';
        const name = (sale.seller as any)?.full_name ?? 'Desconocido';
        const current = byDriver.get(key) ?? { name, units: 0 };
        current.units += units;
        byDriver.set(key, current);
      }

      for (const item of sale.sale_items ?? []) {
        const model = (item as any).product_model;
        if (!model) continue;
        const key = `${model.brand} ${model.model_name}`;
        const current = byModel.get(key) ?? { name: key, units: 0 };
        current.units += item.quantity;
        byModel.set(key, current);
      }
    }

    const { data: orders, error: ordersErr } = await supabase
      .from('commercial_orders')
      .select('point_of_sale:points_of_sale(name), commercial_order_items(quantity)')
      .eq('status', 'dispatched')
      .gte('dispatched_at', from.toISOString())
      .lte('dispatched_at', to.toISOString());

    if (ordersErr) return NextResponse.json({ error: ordersErr.message }, { status: 500 });

    const byCompany = new Map<string, { name: string; units: number }>();
    for (const order of orders ?? []) {
      const name = (order as any).point_of_sale?.name ?? 'Desconocida';
      const units = ((order as any).commercial_order_items ?? []).reduce((s: number, i: any) => s + i.quantity, 0);
      const current = byCompany.get(name) ?? { name, units: 0 };
      current.units += units;
      byCompany.set(name, current);
    }

    return NextResponse.json({
      byDriver: Array.from(byDriver.values()).sort((a, b) => b.units - a.units),
      topModels: Array.from(byModel.values()).sort((a, b) => b.units - a.units).slice(0, 10),
      byCompany: Array.from(byCompany.values()).sort((a, b) => b.units - a.units),
      byOrigin,
      warrantyCount,
      warehouseDirectCount,
      warehouseDirectUnits,
    });
  } catch (err) {
    console.error('GET /api/admin/stats', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error inesperado al calcular estadísticas' },
      { status: 500 }
    );
  }
}
