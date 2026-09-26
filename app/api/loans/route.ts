import { NextRequest, NextResponse } from 'next/server';
import { createRouteClient } from '@/lib/supabaseServer';
import { z } from 'zod';

const bodySchema = z.object({
  product_model_id: z.string().uuid(),
  quantity: z.number().int().positive(),
  borrower_name: z.string().min(1),
  borrower_contact: z.string().optional(),
  notes: z.string().optional(),
});

// POST /api/loans -> registra un préstamo (admin/almacenero). Descuenta el
// almacén sin ser una venta.
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

    const { data, error } = await supabase.rpc('fn_create_loan', {
      p_product_model_id: body.product_model_id,
      p_quantity: body.quantity,
      p_borrower_name: body.borrower_name,
      p_borrower_contact: body.borrower_contact ?? null,
      p_notes: body.notes ?? null,
    });

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ loan_id: data });
  } catch (err) {
    console.error('POST /api/loans', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error inesperado al registrar el préstamo' },
      { status: 500 }
    );
  }
}

// GET /api/loans?status= -> lista de préstamos (admin/almacenero)
export async function GET(req: NextRequest) {
  try {
    const supabase = createRouteClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', session.user.id).single();
    if (!profile || !['admin', 'almacenero'].includes(profile.role)) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
    }

    const statusParam = req.nextUrl.searchParams.get('status');
    let query = supabase
      .from('loans')
      .select('*, product_model:product_models(brand, model_name), loaned_by_profile:profiles!loans_loaned_by_fkey(full_name), loan_returns(id, quantity, returned_at, notes)')
      .order('created_at', { ascending: false });

    if (statusParam) query = query.eq('status', statusParam);

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ loans: data });
  } catch (err) {
    console.error('GET /api/loans', err);
    return NextResponse.json({ error: 'Error inesperado al listar los préstamos' }, { status: 500 });
  }
}
