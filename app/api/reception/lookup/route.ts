import { NextRequest, NextResponse } from 'next/server';
import { createRouteClient } from '@/lib/supabaseServer';

// GET /api/reception/lookup?ean=XXXXXXXXXXXXX
// Busca si un código EAN ya está asociado a un modelo de producto.
export async function GET(req: NextRequest) {
  const supabase = createRouteClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const ean = req.nextUrl.searchParams.get('ean');
  if (!ean) return NextResponse.json({ error: 'Falta el parámetro ean' }, { status: 400 });

  const { data: eanRow, error: eanErr } = await supabase
    .from('product_ean_codes')
    .select('product_model_id')
    .eq('ean_code', ean)
    .maybeSingle();

  if (eanErr) return NextResponse.json({ error: eanErr.message }, { status: 500 });

  if (!eanRow) {
    return NextResponse.json({ found: false });
  }

  const { data: model, error: modelErr } = await supabase
    .from('product_models')
    .select('*')
    .eq('id', eanRow.product_model_id)
    .single();

  if (modelErr) return NextResponse.json({ error: modelErr.message }, { status: 500 });

  return NextResponse.json({ found: true, product_model: model });
}
