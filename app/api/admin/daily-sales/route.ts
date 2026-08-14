import { NextRequest, NextResponse } from 'next/server';
import { createRouteClient } from '@/lib/supabaseServer';

// GET /api/admin/daily-sales?start=ISO&end=ISO
// Resumen de ventas (conductores y venta directa de almacén) entre `start` y
// `end` (timestamps ISO ya calculados por el navegador del usuario, para
// evitar desfases de zona horaria). Si se pide el día de HOY, `end` debe ser
// el momento actual (no el final del día) para que las ventas aparezcan al
// instante; el frontend ya se encarga de eso.
export async function GET(req: NextRequest) {
  try {
    const supabase = createRouteClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', session.user.id).single();
    if (profile?.role !== 'admin') return NextResponse.json({ error: 'No autorizado' }, { status: 403 });

    const startParam = req.nextUrl.searchParams.get('start');
    const endParam = req.nextUrl.searchParams.get('end');
    if (!startParam || !endParam) {
      return NextResponse.json({ error: 'Faltan los parámetros start y end' }, { status: 400 });
    }

    const { data: sales, error } = await supabase
      .from('sales')
      .select(
        'id, seller_id, sale_channel, amount_cash, amount_card, total_amount, sold_at, old_battery_returned, seller:profiles(full_name), sale_items(quantity)'
      )
      .in('sale_channel', ['driver', 'warehouse_direct'])
      .gte('sold_at', startParam)
      .lte('sold_at', endParam)
      .order('sold_at', { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    type Agg = {
      seller_id: string;
      seller_name: string;
      sale_channel: string;
      units_sold: number;
      units_cash: number;
      units_card: number;
      cash_total: number;
      card_total: number;
      sales_count: number;
      old_batteries_collected: number;
    };
    const bySeller = new Map<string, Agg>();

    for (const sale of sales ?? []) {
      const key = sale.seller_id ?? 'desconocido';
      const units = (sale.sale_items ?? []).reduce((sum: number, i: any) => sum + i.quantity, 0);
      const cash = sale.amount_cash ?? 0;
      const card = sale.amount_card ?? 0;

      // Reparte las unidades de esta venta entre efectivo/tarjeta según cómo
      // se cobró (si fue mixta, se reparte proporcionalmente al importe).
      let unitsCash = 0;
      let unitsCard = 0;
      if (cash > 0 && card > 0) {
        const ratio = cash / (cash + card);
        unitsCash = Math.round(units * ratio);
        unitsCard = units - unitsCash;
      } else if (card > 0) {
        unitsCard = units;
      } else {
        unitsCash = units; // incluye garantías a 0€: se cuentan como "efectivo" (sin cobro)
      }

      const current = bySeller.get(key) ?? {
        seller_id: key,
        seller_name: (sale.seller as any)?.full_name ?? 'Desconocido',
        sale_channel: sale.sale_channel,
        units_sold: 0,
        units_cash: 0,
        units_card: 0,
        cash_total: 0,
        card_total: 0,
        sales_count: 0,
        old_batteries_collected: 0,
      };
      current.units_sold += units;
      current.units_cash += unitsCash;
      current.units_card += unitsCard;
      current.cash_total += cash;
      current.card_total += card;
      current.sales_count += 1;
      if (sale.old_battery_returned) current.old_batteries_collected += 1;
      bySeller.set(key, current);
    }

    const rows = Array.from(bySeller.values()).sort(
      (a, b) => b.cash_total + b.card_total - (a.cash_total + a.card_total)
    );

    const totals = rows.reduce(
      (acc, r) => ({
        units_sold: acc.units_sold + r.units_sold,
        units_cash: acc.units_cash + r.units_cash,
        units_card: acc.units_card + r.units_card,
        cash_total: acc.cash_total + r.cash_total,
        card_total: acc.card_total + r.card_total,
        old_batteries_collected: acc.old_batteries_collected + r.old_batteries_collected,
      }),
      { units_sold: 0, units_cash: 0, units_card: 0, cash_total: 0, card_total: 0, old_batteries_collected: 0 }
    );

    return NextResponse.json({ rows, totals });
  } catch (err) {
    console.error('GET /api/admin/daily-sales', err);
    return NextResponse.json({ error: 'Error inesperado al calcular el resumen' }, { status: 500 });
  }
}
