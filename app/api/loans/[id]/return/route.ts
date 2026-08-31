import { NextRequest, NextResponse } from 'next/server';
import { createRouteClient } from '@/lib/supabaseServer';
import { z } from 'zod';

const bodySchema = z.object({
  quantity: z.number().int().positive(),
  notes: z.string().optional(),
});

// POST /api/loans/:id/return -> registra la devolución (total o parcial) de
// un préstamo: repone el stock del almacén.
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

    const { error } = await supabase.rpc('fn_return_loan', {
      p_loan_id: params.id,
      p_quantity: body.quantity,
      p_notes: body.notes ?? null,
    });

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('POST /api/loans/[id]/return', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error inesperado al registrar la devolución' },
      { status: 500 }
    );
  }
}
