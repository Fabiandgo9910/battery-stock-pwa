import { NextRequest, NextResponse } from 'next/server';
import { createRouteClient } from '@/lib/supabaseServer';
import { z } from 'zod';

const schema = z.object({
  name: z.string().min(1),
  owner_name: z.string().optional(),
  tax_id: z.string().optional(),
  address: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  notes: z.string().optional(),
});

async function requireAuth(supabase: ReturnType<typeof createRouteClient>) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { error: NextResponse.json({ error: 'No autenticado' }, { status: 401 }) };
  return { session };
}

async function requireCommercialOrAdmin(supabase: ReturnType<typeof createRouteClient>) {
  const guard = await requireAuth(supabase);
  if (guard.error) return guard;
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', guard.session!.user.id).single();
  if (!profile || !['admin', 'comercial'].includes(profile.role)) {
    return { error: NextResponse.json({ error: 'No autorizado' }, { status: 403 }) };
  }
  return guard;
}

// GET /api/points-of-sale -> lista con su stock por modelo.
// Lectura permitida a admin, comercial y almacenero (para poder vender);
// la gestión (crear/editar/eliminar) queda solo para admin/comercial.
export async function GET() {
  try {
    const supabase = createRouteClient();
    const guard = await requireAuth(supabase);
    if (guard.error) return guard.error;

    const { data, error } = await supabase
      .from('points_of_sale')
      .select('*, pos_stock(quantity, product_model:product_models(brand, model_name))')
      .order('name');

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ points_of_sale: data });
  } catch (err) {
    console.error('GET /api/points-of-sale', err);
    return NextResponse.json({ error: 'Error inesperado al listar ventas comerciales' }, { status: 500 });
  }
}

// POST /api/points-of-sale -> crea cliente de venta comercial (admin/comercial)
export async function POST(req: NextRequest) {
  try {
    const supabase = createRouteClient();
    const guard = await requireCommercialOrAdmin(supabase);
    if (guard.error) return guard.error;

    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues.map((i) => i.message).join(' · ') }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('points_of_sale')
      .insert({ ...parsed.data, created_by: guard.session!.user.id })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ point_of_sale: data });
  } catch (err) {
    console.error('POST /api/points-of-sale', err);
    return NextResponse.json({ error: 'Error inesperado al crear la venta comercial' }, { status: 500 });
  }
}
