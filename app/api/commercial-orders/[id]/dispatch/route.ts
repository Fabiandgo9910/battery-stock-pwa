import { NextRequest, NextResponse } from 'next/server';
import { createRouteClient } from '@/lib/supabaseServer';
import { z } from 'zod';

const bodySchema = z.object({
  items: z.array(z.object({ product_model_id: z.string().uuid(), quantity: z.number().int().positive() })).min(1).optional(),
  notes: z.string().optional(),
});

// POST /api/commercial-orders/:id/dispatch -> el almacén DA SALIDA al
// pedido: aquí sí se descuenta el stock del almacén de verdad. Puede editar
// los ítems antes de confirmar (por si un modelo no existía).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = createRouteClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', session.user.id).single();
    if (!profile || !['admin', 'almacenero'].includes(profile.role)) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
    }

    const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues.map((i) => i.message).join(' · ') }, { status: 400 });
    }
    const body = parsed.data;

    const { error } = await supabase.rpc('fn_dispatch_commercial_order', {
      p_order_id: params.id,
      p_items: body.items ?? null,
      p_notes: body.notes ?? null,
    });

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('POST /api/commercial-orders/[id]/dispatch', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error inesperado al dar salida al pedido' },
      { status: 500 }
    );
  }
}
