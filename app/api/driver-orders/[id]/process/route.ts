import { NextRequest, NextResponse } from 'next/server';
import { createRouteClient } from '@/lib/supabaseServer';
import { z } from 'zod';

const bodySchema = z.object({
  items: z.array(z.object({ product_model_id: z.string().uuid(), quantity: z.number().int().positive() })).min(1),
  notes: z.string().optional(),
});

// POST /api/driver-orders/:id/process -> el almacén PREPARA una solicitud de
// pedido del conductor: puede editar modelos/cantidades (por si un modelo no
// existía o no hay stock suficiente) y, al procesarla, pasa a "pendiente de
// respuesta" para el conductor. Sigue sin mover stock.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = createRouteClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', session.user.id).single();
    if (!profile || !['admin', 'almacenero'].includes(profile.role)) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
    }

    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues.map((i) => i.message).join(' · ') }, { status: 400 });
    }
    const body = parsed.data;

    const { error } = await supabase.rpc('fn_process_driver_order_request', {
      p_order_id: params.id,
      p_items: body.items,
      p_notes: body.notes ?? null,
    });

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    const { data: batteryUnits } = await supabase
      .from('battery_units')
      .select('id, code, product_model_id, product_model:product_models(brand, model_name)')
      .eq('delivery_id', params.id)
      .order('code');

    return NextResponse.json({ ok: true, battery_units: batteryUnits ?? [] });
  } catch (err) {
    console.error('POST /api/driver-orders/[id]/process', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error inesperado al procesar el pedido' },
      { status: 500 }
    );
  }
}
