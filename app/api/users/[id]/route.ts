import { NextRequest, NextResponse } from 'next/server';
import { createRouteClient } from '@/lib/supabaseServer';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';

const updateSchema = z.object({
  full_name: z.string().min(1).optional(),
  role: z.enum(['admin', 'almacenero', 'conductor', 'comercial']).optional(),
  phone: z.string().optional(),
  vehicle_plate: z.string().optional(),
  zone: z.string().optional(),
  active: z.boolean().optional(),
});

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error('Faltan variables de entorno NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el servidor.');
  }
  return createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function requireAdmin(supabase: ReturnType<typeof createRouteClient>) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { error: NextResponse.json({ error: 'No autenticado' }, { status: 401 }) };
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', session.user.id).single();
  if (profile?.role !== 'admin') return { error: NextResponse.json({ error: 'No autorizado' }, { status: 403 }) };
  return { session };
}

// PATCH /api/users/:id -> editar usuario (solo admin)
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = createRouteClient();
    const guard = await requireAdmin(supabase);
    if (guard.error) return guard.error;

    const parsed = updateSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues.map((i) => i.message).join(' · ') }, { status: 400 });
    }

    const { error } = await supabase.from('profiles').update(parsed.data).eq('id', params.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('PATCH /api/users/[id]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error inesperado al editar el usuario' },
      { status: 500 }
    );
  }
}

// DELETE /api/users/:id                 -> desactiva (soft, por defecto)
// DELETE /api/users/:id?permanent=true  -> elimina de verdad (Auth + perfil),
//   SALVO que el usuario sea conductor/almacenero y tenga stock físico
//   asignado (driver_stock con cantidad > 0): en ese caso se bloquea con un
//   mensaje explícito y NO se borra ni se desactiva, para forzar a retirarle
//   el stock antes.
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = createRouteClient();
    const guard = await requireAdmin(supabase);
    if (guard.error) return guard.error;

    const permanent = req.nextUrl.searchParams.get('permanent') === 'true';

    // Comprobación explícita de stock (aplica a cualquier rol que pueda tener
    // driver_stock: conductores, y almaceneros que venden directo también
    // podrían tener saldo en su billetera pero no stock propio salvo que se
    // les haya entregado algo por error).
    const { data: stockRows, error: stockErr } = await supabase
      .from('driver_stock')
      .select('quantity, product_model:product_models(brand, model_name)')
      .eq('driver_id', params.id)
      .gt('quantity', 0);

    if (stockErr) {
      return NextResponse.json({ error: `No se pudo comprobar el stock: ${stockErr.message}` }, { status: 500 });
    }

    if (stockRows && stockRows.length > 0) {
      const detail = stockRows
        .map((r: any) => `${r.product_model?.brand ?? ''} ${r.product_model?.model_name ?? ''} (${r.quantity})`)
        .join(', ');
      return NextResponse.json(
        {
          error: `No se puede eliminar: el usuario todavía tiene stock asignado — ${detail}. Retírale el stock (entrégalo a otro conductor o haz una devolución al almacén) y vuelve a intentarlo.`,
          reason: 'stock',
        },
        { status: 409 }
      );
    }

    if (!permanent) {
      const { error } = await supabase.from('profiles').update({ active: false }).eq('id', params.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true, deleted: false });
    }

    // Sin stock pendiente: procedemos al borrado permanente real.
    const admin = adminClient();
    const { error: authErr } = await admin.auth.admin.deleteUser(params.id);

    if (authErr) {
      return NextResponse.json(
        { error: `No se pudo eliminar: ${authErr.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, deleted: true });
  } catch (err) {
    console.error('DELETE /api/users/[id]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error inesperado al eliminar el usuario' },
      { status: 500 }
    );
  }
}
