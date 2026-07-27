import { NextRequest, NextResponse } from 'next/server';
import { createRouteClient } from '@/lib/supabaseServer';

// POST /api/driver-orders/:id/acknowledge -> el admin/almacenero marca como
// vista una entrega que un conductor rechazó (cierra el aviso emergente).
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = createRouteClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', session.user.id).single();
    if (!profile || !['admin', 'almacenero'].includes(profile.role)) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
    }

    const { error } = await supabase
      .from('driver_deliveries')
      .update({ rejection_acknowledged_at: new Date().toISOString() })
      .eq('id', params.id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('POST /api/driver-orders/[id]/acknowledge', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error inesperado al marcar como visto' },
      { status: 500 }
    );
  }
}
