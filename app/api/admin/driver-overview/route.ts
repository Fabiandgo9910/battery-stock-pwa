import { NextResponse } from 'next/server';
import { createRouteClient } from '@/lib/supabaseServer';

// GET /api/admin/driver-overview -> por cada conductor: su caja (efectivo/tarjeta)
// y el stock de baterías que le queda. Solo admin.
export async function GET() {
  try {
    const supabase = createRouteClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', session.user.id).single();
    if (profile?.role !== 'admin') return NextResponse.json({ error: 'No autorizado' }, { status: 403 });

    const { data: drivers, error: driversErr } = await supabase
      .from('profiles')
      .select('id, full_name, vehicle_plate, zone, active')
      .eq('role', 'conductor')
      .order('full_name');
    if (driversErr) return NextResponse.json({ error: driversErr.message }, { status: 500 });

    const { data: wallets, error: walletsErr } = await supabase
      .from('driver_wallets')
      .select('driver_id, cash_balance, card_balance, last_reset_at');
    if (walletsErr) return NextResponse.json({ error: walletsErr.message }, { status: 500 });

    const { data: stock, error: stockErr } = await supabase
      .from('driver_stock')
      .select('driver_id, product_model_id, quantity, product_model:product_models(brand, model_name, product_ean_codes(ean_code))')
      .gt('quantity', 0);
    if (stockErr) return NextResponse.json({ error: stockErr.message }, { status: 500 });

    const walletByDriver = new Map(wallets?.map((w) => [w.driver_id, w]));
    const stockByDriver = new Map<string, typeof stock>();
    stock?.forEach((row) => {
      const list = stockByDriver.get(row.driver_id) ?? [];
      list.push(row);
      stockByDriver.set(row.driver_id, list as any);
    });

    const result = (drivers ?? []).map((d) => ({
      driver: d,
      wallet: walletByDriver.get(d.id) ?? { cash_balance: 0, card_balance: 0, last_reset_at: null },
      stock: stockByDriver.get(d.id) ?? [],
    }));

    return NextResponse.json({ drivers: result });
  } catch (err) {
    console.error('GET /api/admin/driver-overview', err);
    return NextResponse.json({ error: 'Error inesperado al cargar los conductores' }, { status: 500 });
  }
}
