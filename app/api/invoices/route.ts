import { NextResponse } from 'next/server';
import { createRouteClient } from '@/lib/supabaseServer';

// GET /api/invoices -> facturas del comercial autenticado (o todas si admin)
export async function GET() {
  try {
    const supabase = createRouteClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

    const { data, error } = await supabase
      .from('invoices')
      .select('*, point_of_sale:points_of_sale(name), invoice_items(*)')
      .order('created_at', { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ invoices: data });
  } catch (err) {
    console.error('GET /api/invoices', err);
    return NextResponse.json({ error: 'Error inesperado al listar las facturas' }, { status: 500 });
  }
}
