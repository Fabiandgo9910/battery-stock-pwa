import { NextRequest, NextResponse } from 'next/server';
import { createRouteClient } from '@/lib/supabaseServer';

// GET /api/admin/daily-sales?date=YYYY-MM-DD
// Resumen del día: por cada conductor, cuántas baterías vendió y cuánto
// cobró en efectivo y en tarjeta. Solo admin.
export async function GET(req: NextRequest) {
  try {
    const supabase = createRouteClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', session.user.id).single();
    if (profile?.role !== 'admin') return NextResponse.json({ error: 'No autorizado' }, { status: 403 });

    const dateParam = req.nextUrl.searchParams.get('date');
    const date = dateParam ? new Date(dateParam) : new Date();
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(date);
    end.setHours(23, 59, 59, 999);

    const { data: sales, error } = await supabase
      .from('sales')
      .select('id, seller_id, amount_cash, amount_card, total_amount, sold_at, seller:profiles(full_name), sale_items(quantity)')
      .eq('sale_channel', 'driver')
      .gte('sold_at', start.toISOString())
      .lte('sold_at', end.toISOString())
      .order('sold_at', { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    type Agg = {
      driver_id: string;
      driver_name: string;
      units_sold: number;
      cash_total: number;
      card_total: number;
      sales_count: number;
    };
    const byDriver = new Map<string, Agg>();

    for (const sale of sales ?? []) {
      const key = sale.seller_id;
      const units = (sale.sale_items ?? []).reduce((sum: number, i: any) => sum + i.quantity, 0);
      const current = byDriver.get(key) ?? {
        driver_id: key,
        driver_name: (sale.seller as any)?.full_name ?? 'Desconocido',
        units_sold: 0,
        cash_total: 0,
        card_total: 0,
        sales_count: 0,
      };
      current.units_sold += units;
      current.cash_total += sale.amount_cash ?? 0;
      current.card_total += sale.amount_card ?? 0;
      current.sales_count += 1;
      byDriver.set(key, current);
    }

    const rows = Array.from(byDriver.values()).sort((a, b) => b.cash_total + b.card_total - (a.cash_total + a.card_total));

    const totals = rows.reduce(
      (acc, r) => ({
        units_sold: acc.units_sold + r.units_sold,
        cash_total: acc.cash_total + r.cash_total,
        card_total: acc.card_total + r.card_total,
      }),
      { units_sold: 0, cash_total: 0, card_total: 0 }
    );

    return NextResponse.json({ date: start.toISOString().slice(0, 10), rows, totals });
  } catch (err) {
    console.error('GET /api/admin/daily-sales', err);
    return NextResponse.json({ error: 'Error inesperado al calcular el resumen diario' }, { status: 500 });
  }
}
