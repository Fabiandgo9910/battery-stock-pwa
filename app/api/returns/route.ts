import { NextRequest, NextResponse } from 'next/server';
import { createRouteClient } from '@/lib/supabaseServer';
import { z } from 'zod';

const bodySchema = z.object({
  type: z.enum(['devolucion', 'garantia']),
  product_model_id: z.string().uuid(),
  quantity: z.number().int().positive(),
  source_driver_id: z.string().uuid().optional(),
  destination_warehouse_id: z.string().uuid().optional(),
  notes: z.string().optional(),
});

// POST /api/returns -> registra una devolución al almacén.
// - 'devolucion': vuelve al stock normal (vendible).
// - 'garantia': va a un almacén aparte (no se mezcla con el stock vendible).
// Si viene de un conductor (source_driver_id), se le resta de su stock.
export async function POST(req: NextRequest) {
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

    const { data, error } = await supabase.rpc('fn_process_return', {
      p_type: body.type,
      p_product_model_id: body.product_model_id,
      p_quantity: body.quantity,
      p_source_driver_id: body.source_driver_id ?? null,
      p_destination_warehouse_id: body.destination_warehouse_id ?? null,
      p_notes: body.notes ?? null,
    });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ return_id: data });
  } catch (err) {
    console.error('POST /api/returns', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error inesperado al registrar la devolución' },
      { status: 500 }
    );
  }
}

// GET /api/returns -> histórico reciente de devoluciones (admin/almacenero)
export async function GET() {
  try {
    const supabase = createRouteClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

    const { data, error } = await supabase
      .from('returns')
      .select('*, product_model:product_models(brand, model_name), source_driver:profiles(full_name)')
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ returns: data });
  } catch (err) {
    console.error('GET /api/returns', err);
    return NextResponse.json({ error: 'Error inesperado al listar devoluciones' }, { status: 500 });
  }
}
