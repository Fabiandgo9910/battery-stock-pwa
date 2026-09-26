import { NextRequest, NextResponse } from 'next/server';
import { createRouteClient } from '@/lib/supabaseServer';

// GET /api/conductor/stats?from=&to() -> mis propias ventas: total, y
// desglose por origen (particular/web/mapfre) y garantías.
export async function GET(req: NextRequest) {
  try {
    const supabase = createRouteClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

    const fromParam = req.nextUrl.searchParams.get('from');
    const toParam = req.nextUrl.searchParams.get('to');
    if (!fromParam || !toParam) {
      return NextResponse.json({ error: 'Indica el rango de fechas (from/to)' }, { status: 400 });
    }
    const from = new Date(fromParam);
    from.setHours(0, 0, 0, 0);
    const to = new Date(toParam);
    to.setHours(23, 59, 59, 999);

    const { data: sales, error } = await supabase
      .from('sales')
      .select('is_warranty, sale_origin, sale_items(quantity)')
      .eq('seller_id', session.user.id)
      .eq('sale_channel', 'driver')
      .gte('sold_at', from.toISOString())
      .lte('sold_at', to.toISOString());

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    let total = 0;
    let warranty = 0;
    const byOrigin = { particular: 0, web: 0, mapfre: 0 };

    for (const sale of sales ?? []) {
      const units = (sale.sale_items ?? []).reduce((sum: number, i: any) => sum + i.quantity, 0);
      total += units;
      if (sale.is_warranty) warranty += units;
      const origin = (sale.sale_origin as 'particular' | 'web' | 'mapfre') ?? 'particular';
      byOrigin[origin] = (byOrigin[origin] ?? 0) + units;
    }

    return NextResponse.json({ total, warranty, byOrigin });
  } catch (err) {
    console.error('GET /api/conductor/stats', err);
    return NextResponse.json({ error: 'Error inesperado' }, { status: 500 });
  }
}
