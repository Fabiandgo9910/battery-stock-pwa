import { NextRequest, NextResponse } from 'next/server';
import { createRouteClient } from '@/lib/supabaseServer';
import { z } from 'zod';

const bodySchema = z.object({ driver_id: z.string().uuid() });

// POST /api/wallet-reset -> solo admin, reinicia la caja de un conductor a 0
export async function POST(req: NextRequest) {
  try {
    const supabase = createRouteClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues.map((i) => i.message).join(' · ') }, { status: 400 });
    }

    const { error } = await supabase.rpc('fn_reset_driver_wallet', {
      p_driver_id: parsed.data.driver_id,
    });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('POST /api/wallet-reset', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error inesperado al reiniciar la caja' },
      { status: 500 }
    );
  }
}
