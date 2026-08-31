import { NextRequest, NextResponse } from 'next/server';
import { createRouteClient } from '@/lib/supabaseServer';
import { z } from 'zod';

const bodySchema = z.object({
  ean_code: z.string().min(6),
  brand: z.string().min(1),
  model_name: z.string().min(1),
  amperage_ah: z.number().positive().optional(),
  cold_cranking_amps: z.number().int().positive().optional(),
  battery_tech: z.enum(['normal', 'agm', 'efb']).optional(),
  is_special: z.boolean(),
  special_reason: z.string().optional(),
  min_stock_alert: z.number().int().nonnegative().optional(),
});

// POST /api/product-models  -> crea un nuevo modelo de batería + su código EAN
export async function POST(req: NextRequest) {
  let createdModelId: string | null = null;
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

    const { data: category } = await supabase
      .from('product_categories')
      .select('id')
      .eq('slug', 'baterias')
      .single();

    const { data: model, error: modelErr } = await supabase
      .from('product_models')
      .insert({
        category_id: category?.id,
        brand: body.brand,
        model_name: body.model_name,
        amperage_ah: body.amperage_ah ?? null,
        cold_cranking_amps: body.cold_cranking_amps ?? null,
        battery_tech: body.battery_tech ?? null,
        is_special: body.is_special,
        special_reason: body.is_special ? body.special_reason ?? null : null,
        min_stock_alert: body.min_stock_alert ?? 5,
        created_by: session.user.id,
      })
      .select()
      .single();

    if (modelErr) return NextResponse.json({ error: modelErr.message }, { status: 500 });
    createdModelId = model.id;

    const { error: eanErr } = await supabase.from('product_ean_codes').insert({
      ean_code: body.ean_code,
      product_model_id: model.id,
    });

    if (eanErr) {
      // Revertimos el modelo huérfano (sin EAN no sirve de nada, p. ej. si el
      // código ya estaba en uso por otro modelo).
      await supabase.from('product_models').delete().eq('id', model.id);
      return NextResponse.json({ error: `No se pudo asociar el código EAN: ${eanErr.message}` }, { status: 400 });
    }

    return NextResponse.json({ product_model: model });
  } catch (err) {
    console.error('POST /api/product-models', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error inesperado al crear el modelo' },
      { status: 500 }
    );
  }
}

// GET /api/product-models -> lista de modelos activos (para selects, CRUD)
export async function GET() {
  try {
    const supabase = createRouteClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

    const { data, error } = await supabase
      .from('product_models')
      .select('*, product_ean_codes(ean_code)')
      .eq('active', true)
      .order('brand');

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ product_models: data });
  } catch (err) {
    console.error('GET /api/product-models', err);
    return NextResponse.json({ error: 'Error inesperado al listar los modelos' }, { status: 500 });
  }
}
