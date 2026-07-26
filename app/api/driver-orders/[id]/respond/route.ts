import { NextRequest, NextResponse } from 'next/server';
import { createRouteClient } from '@/lib/supabaseServer';
import { z } from 'zod';

const bodySchema = z.object({ accept: z.boolean() });

// POST /api/driver-orders/:id/respond -> el conductor acepta o rechaza su pedido.
// Aceptar mueve el stock (almacén -> conductor); rechazar no mueve nada.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = createRouteClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues.map((i) => i.message).join(' · ') }, { status: 400 });
    }

    const { error } = await supabase.rpc('fn_respond_driver_order', {
      p_delivery_id: params.id,
      p_accept: parsed.data.accept,
    });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('POST /api/driver-orders/[id]/respond', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error inesperado al responder al pedido' },
      { status: 500 }
    );
  }
}
