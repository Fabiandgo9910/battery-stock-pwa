import { NextRequest, NextResponse } from 'next/server';
import { createRouteClient } from '@/lib/supabaseServer';

// GET /api/admin/seller-sales?seller_id=&start=&end= -> ventas individuales
// de un vendedor en un rango, para poder ver la firma de cada una.
export async function GET(req: NextRequest) {
  try {
    const supabase = createRouteClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', session.user.id).single();
    if (profile?.role !== 'admin') return NextResponse.json({ error: 'No autorizado' }, { status: 403 });

    const sellerId = req.nextUrl.searchParams.get('seller_id');
    const start = req.nextUrl.searchParams.get('start');
    const end = req.nextUrl.searchParams.get('end');
    if (!sellerId || !start || !end) {
      return NextResponse.json({ error: 'Faltan parámetros (seller_id, start, end)' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('sales')
      .select(
        `id, sold_at, total_amount, payment_method, is_warranty, customer_vehicle_plate, sale_origin,
         sale_items(quantity, product_model:product_models(brand, model_name))`
      )
      .eq('seller_id', sellerId)
      .gte('sold_at', start)
      .lte('sold_at', end)
      .order('sold_at', { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ sales: data ?? [] });
  } catch (err) {
    console.error('GET /api/admin/seller-sales', err);
    return NextResponse.json({ error: 'Error inesperado' }, { status: 500 });
  }
}
