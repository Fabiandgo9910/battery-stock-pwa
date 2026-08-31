import { NextRequest, NextResponse } from 'next/server';
import { createRouteClient } from '@/lib/supabaseServer';
import { z } from 'zod';

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  tax_id: z.string().optional(),
  contact_phone: z.string().optional(),
  contact_email: z.string().email().optional().or(z.literal('')),
});

// PATCH /api/suppliers/:id -> editar distribuidor (admin/almacenero)
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = createRouteClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', session.user.id).single();
    if (!profile || !['admin', 'almacenero'].includes(profile.role)) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
    }

    const parsed = updateSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues.map((i) => i.message).join(' · ') }, { status: 400 });
    }

    const { error } = await supabase.from('suppliers').update(parsed.data).eq('id', params.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('PATCH /api/suppliers/[id]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error inesperado al editar el distribuidor' },
      { status: 500 }
    );
  }
}

// DELETE /api/suppliers/:id -> intenta borrar físicamente; si tiene recepciones
// asociadas (integridad referencial), lo desactiva en su lugar.
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = createRouteClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', session.user.id).single();
    if (!profile || !['admin', 'almacenero'].includes(profile.role)) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
    }

    const { error: deleteErr } = await supabase.from('suppliers').delete().eq('id', params.id);

    if (deleteErr) {
      // Probablemente tiene recepciones asociadas (FK). Lo desactivamos en su lugar
      // para no perder la trazabilidad del histórico de recepciones.
      const { error: deactivateErr } = await supabase
        .from('suppliers')
        .update({ active: false })
        .eq('id', params.id);
      if (deactivateErr) return NextResponse.json({ error: deactivateErr.message }, { status: 500 });
      return NextResponse.json({
        ok: true,
        deactivatedInstead: true,
        message: 'Este distribuidor tiene recepciones registradas, así que se ha desactivado en lugar de eliminarse, para conservar el histórico.',
      });
    }

    return NextResponse.json({ ok: true, deactivatedInstead: false });
  } catch (err) {
    console.error('DELETE /api/suppliers/[id]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error inesperado al eliminar el distribuidor' },
      { status: 500 }
    );
  }
}
