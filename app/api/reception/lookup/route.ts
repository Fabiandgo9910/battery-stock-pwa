import { NextRequest, NextResponse } from 'next/server';
import { createRouteClient } from '@/lib/supabaseServer';

// GET /api/reception/lookup?ean=XXXXXXXXXXXXX
// Busca si un código EAN ya está asociado a un modelo de producto.
// Optimizado a UNA sola consulta (join embebido) en vez de dos round-trips
// secuenciales, para que el escaneo se note rápido incluso en 4G/WiFi lento.
export async function GET(req: NextRequest) {
  try {
    const supabase = createRouteClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

    const ean = req.nextUrl.searchParams.get('ean');
    if (!ean) return NextResponse.json({ error: 'Falta el parámetro ean' }, { status: 400 });

    const { data: eanRow, error: eanErr } = await supabase
      .from('product_ean_codes')
      .select('product_model_id, product_model:product_models(*)')
      .eq('ean_code', ean)
      .maybeSingle();

    if (eanErr) return NextResponse.json({ error: eanErr.message }, { status: 500 });

    if (!eanRow || !eanRow.product_model) {
      return NextResponse.json({ found: false });
    }

    return NextResponse.json({ found: true, product_model: eanRow.product_model });
  } catch (err) {
    console.error('GET /api/reception/lookup', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error inesperado al buscar el código' },
      { status: 500 }
    );
  }
}
