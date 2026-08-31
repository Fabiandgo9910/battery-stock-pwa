import { NextRequest, NextResponse } from 'next/server';
import { createRouteClient } from '@/lib/supabaseServer';

// POST /api/driver-orders/:id/cancel -> deshace un pedido que sigue
// pendiente (admin/almacenero). No mueve stock porque un pedido pendiente
// todavía no lo ha movido.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = createRouteClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', session.user.id).single();
    if (!profile || !['admin', 'almacenero'].includes(profile.role)) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
    }

    const { error } = await supabase.rpc('fn_cancel_driver_order', { p_order_id: params.id });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('POST /api/driver-orders/[id]/cancel', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error inesperado al deshacer el pedido' },
      { status: 500 }
    );
  }
}
