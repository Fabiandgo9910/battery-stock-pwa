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
// GET /api/product-models?search=&page=&pageSize= -> lista paginada en el
// servidor (nunca trae todo el catálogo de golpe). Sin parámetros, se
// comporta como antes (útil para integraciones antiguas), pero todo el
// código nuevo debe pasar search/page/pageSize.
export async function GET(req: NextRequest) {
  try {
    const supabase = createRouteClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

    const search = req.nextUrl.searchParams.get('search')?.trim() ?? '';
    const page = Math.max(1, Number(req.nextUrl.searchParams.get('page')) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.nextUrl.searchParams.get('pageSize')) || 8));
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = supabase
      .from('product_models')
      .select(
        '*, product_ean_codes(ean_code), warehouse_stock(quantity, warehouse:warehouses(is_warranty_holding))',
        { count: 'exact' }
      )
      .eq('active', true)
      .order('brand')
      .order('model_name');

    if (search) {
      // Busca por marca, modelo, referencia o EAN (OR en varias columnas).
      // Se limpian caracteres que romperían la sintaxis del filtro .or().
      const safe = search.replace(/[,()]/g, ' ').trim();
      if (safe) {
        query = query.or(
          `brand.ilike.%${safe}%,model_name.ilike.%${safe}%,reference_code.ilike.%${safe}%`
        );
      }
    }

    const { data, error, count } = await query.range(from, to);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ product_models: data, total: count ?? 0 });
  } catch (err) {
    console.error('GET /api/product-models', err);
    return NextResponse.json({ error: 'Error inesperado al listar los modelos' }, { status: 500 });
  }
}
