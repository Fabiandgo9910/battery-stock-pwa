import { NextRequest, NextResponse } from 'next/server';
import { createRouteClient } from '@/lib/supabaseServer';
import { z } from 'zod';

const schema = z.object({
  items: z.array(z.object({ id: z.string().uuid(), unit_price: z.number().nonnegative() })),
  status: z.enum(['draft', 'issued', 'paid', 'cancelled']).optional(),
  tax_rate: z.number().nonnegative().optional(),
});

// PATCH /api/invoices/:id -> edita precios (antes en blanco) y recalcula totales
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createRouteClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const body = parsed.data;

  let subtotal = 0;
  for (const item of body.items) {
    const { data: line } = await supabase.from('invoice_items').select('quantity').eq('id', item.id).single();
    const lineTotal = (line?.quantity ?? 0) * item.unit_price;
    subtotal += lineTotal;
    await supabase.from('invoice_items').update({ unit_price: item.unit_price, line_total: lineTotal }).eq('id', item.id);
  }

  const taxRate = body.tax_rate ?? 21;
  const taxAmount = subtotal * (taxRate / 100);
  const total = subtotal + taxAmount;

  const { error } = await supabase
    .from('invoices')
    .update({
      subtotal,
      tax_rate: taxRate,
      tax_amount: taxAmount,
      total,
      status: body.status ?? 'issued',
      issued_at: new Date().toISOString(),
    })
    .eq('id', params.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, total });
}
