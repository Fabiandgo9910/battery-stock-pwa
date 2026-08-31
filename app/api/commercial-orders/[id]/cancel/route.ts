import { NextRequest, NextResponse } from 'next/server';
import { createRouteClient } from '@/lib/supabaseServer';

// POST /api/commercial-orders/:id/cancel -> cancela mientras siga pendiente
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = createRouteClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

    const { error } = await supabase.rpc('fn_cancel_commercial_order', { p_order_id: params.id });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('POST /api/commercial-orders/[id]/cancel', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error inesperado al cancelar el pedido' },
      { status: 500 }
    );
  }
}
