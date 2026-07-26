import { NextRequest, NextResponse } from 'next/server';
import { createRouteClient } from '@/lib/supabaseServer';
import { z } from 'zod';

const bodySchema = z.object({
  warehouse_id: z.string().uuid(),
  supplier_id: z.string().uuid(),
  product_model_id: z.string().uuid(),
  ean_code: z.string().min(6),
  quantity: z.number().int().positive(),
  notes: z.string().optional(),
});

// POST /api/reception -> registra una recepción de mercancía (entrada a almacén)
export async function POST(req: NextRequest) {
  try {
    const supabase = createRouteClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
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

    const { data, error } = await supabase.rpc('fn_receive_stock', {
      p_warehouse_id: body.warehouse_id,
      p_supplier_id: body.supplier_id,
      p_product_model_id: body.product_model_id,
      p_ean_code: body.ean_code,
      p_quantity: body.quantity,
      p_notes: body.notes ?? null,
    });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ reception_id: data });
  } catch (err) {
    console.error('POST /api/reception', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error inesperado al registrar la recepción' },
      { status: 500 }
    );
  }
}
