import { NextRequest, NextResponse } from 'next/server';
import { createRouteClient } from '@/lib/supabaseServer';
import { z } from 'zod';

const bodySchema = z.object({
  point_of_sale_id: z.string().uuid(),
  quantity: z.number().int().positive(),
  weight_kg: z.number().positive().optional(),
  notes: z.string().optional(),
});

// GET /api/scrap-deliveries?from=&to=&page=&pageSize= -> lista paginada de entregas de chatarra
export async function GET(req: NextRequest) {
  try {
    const supabase = createRouteClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

    const page = Math.max(1, Number(req.nextUrl.searchParams.get('page')) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.nextUrl.searchParams.get('pageSize')) || 15));
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = supabase
      .from('scrap_deliveries')
      .select('id, quantity, weight_kg, notes, created_at, point_of_sale:points_of_sale(name)', { count: 'exact' })
      .order('created_at', { ascending: false });

    const fromDate = req.nextUrl.searchParams.get('from');
    const toDate = req.nextUrl.searchParams.get('to');
    if (fromDate) query = query.gte('created_at', fromDate);
    if (toDate) query = query.lte('created_at', toDate);

    const { data, error, count } = await query.range(from, to);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ scrap_deliveries: data ?? [], total: count ?? 0 });
  } catch (err) {
    console.error('GET /api/scrap-deliveries', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error inesperado' },
      { status: 500 }
    );
  }
}

// POST /api/scrap-deliveries -> registra una entrega de baterías viejas de una empresa
export async function POST(req: NextRequest) {
  try {
    const supabase = createRouteClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', session.user.id).single();
    if (!profile || !['admin', 'almacenero', 'comercial'].includes(profile.role)) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
    }

    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues.map((i) => i.message).join(' · ') }, { status: 400 });
    }
    const body = parsed.data;

    const { data, error } = await supabase
      .from('scrap_deliveries')
      .insert({
        point_of_sale_id: body.point_of_sale_id,
        quantity: body.quantity,
        weight_kg: body.weight_kg ?? null,
        notes: body.notes ?? null,
        created_by: session.user.id,
      })
      .select('id')
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ id: data.id });
  } catch (err) {
    console.error('POST /api/scrap-deliveries', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error inesperado al registrar la entrega' },
      { status: 500 }
    );
  }
}
