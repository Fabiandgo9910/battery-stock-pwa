import { NextRequest, NextResponse } from 'next/server';
import { createRouteClient } from '@/lib/supabaseServer';
import { z } from 'zod';

const KINDS = ['driver_delivery', 'commercial_order', 'warehouse_sale'] as const;

const bodySchema = z.object({
  kind: z.enum(KINDS),
  reference_id: z.string().uuid(),
  signer_name: z.string().optional(),
  notes: z.string().optional(),
  signature_data_url: z.string().min(1),
});

// GET /api/signatures?kind=driver_delivery&reference_id=... -> la firma de esa entrega, si existe
export async function GET(req: NextRequest) {
  try {
    const supabase = createRouteClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

    const kind = req.nextUrl.searchParams.get('kind');
    const referenceId = req.nextUrl.searchParams.get('reference_id');
    if (!kind || !referenceId || !KINDS.includes(kind as any)) {
      return NextResponse.json({ error: 'Faltan parámetros (kind, reference_id)' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('delivery_signatures')
      .select('signer_name, notes, signature_data_url, created_at')
      .eq('kind', kind)
      .eq('reference_id', referenceId)
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ signature: data });
  } catch (err) {
    console.error('GET /api/signatures', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error inesperado' },
      { status: 500 }
    );
  }
}

// POST /api/signatures -> guarda la firma de una entrega ya realizada
export async function POST(req: NextRequest) {
  try {
    const supabase = createRouteClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', session.user.id).single();
    if (profile?.role !== 'admin' && profile?.role !== 'almacenero' && profile?.role !== 'comercial') {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
    }

    const parsed = bodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.errors[0]?.message ?? 'Datos inválidos' }, { status: 400 });
    }
    const body = parsed.data;

    const { error } = await supabase.from('delivery_signatures').upsert(
      {
        kind: body.kind,
        reference_id: body.reference_id,
        signer_name: body.signer_name || null,
        notes: body.notes || null,
        signature_data_url: body.signature_data_url,
        created_by: session.user.id,
      },
      { onConflict: 'kind,reference_id' }
    );

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('POST /api/signatures', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error inesperado al guardar la firma' },
      { status: 500 }
    );
  }
}
