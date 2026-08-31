import { NextRequest, NextResponse } from 'next/server';
import { createRouteClient } from '@/lib/supabaseServer';

// GET /api/admin/office-wallet -> saldo actual de la caja de oficina (venta directa de almacén)
export async function GET() {
  try {
    const supabase = createRouteClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

    const { data, error } = await supabase.from('office_wallet').select('*').eq('id', 1).single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ wallet: data });
  } catch (err) {
    console.error('GET /api/admin/office-wallet', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error inesperado' },
      { status: 500 }
    );
  }
}

// POST /api/admin/office-wallet -> solo admin, reinicia la caja de oficina a 0
export async function POST(req: NextRequest) {
  try {
    const supabase = createRouteClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

    const { error } = await supabase.rpc('fn_reset_office_wallet');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('POST /api/admin/office-wallet', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error inesperado al reiniciar la caja' },
      { status: 500 }
    );
  }
}
