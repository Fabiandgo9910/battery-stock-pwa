import { NextRequest, NextResponse } from 'next/server';
import { createRouteClient } from '@/lib/supabaseServer';
import { z } from 'zod';

const schema = z.object({
  name: z.string().min(1),
  tax_id: z.string().optional(),
  contact_phone: z.string().optional(),
  contact_email: z.string().email().optional().or(z.literal('')),
});

export async function GET() {
  try {
    const supabase = createRouteClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

    const { data, error } = await supabase.from('suppliers').select('*').eq('active', true).order('name');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ suppliers: data });
  } catch (err) {
    console.error('GET /api/suppliers', err);
    return NextResponse.json({ error: 'Error inesperado al listar los distribuidores' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = createRouteClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues.map((i) => i.message).join(' · ') }, { status: 400 });
    }

    const { data, error } = await supabase.from('suppliers').insert(parsed.data).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ supplier: data });
  } catch (err) {
    console.error('POST /api/suppliers', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error inesperado al crear el distribuidor' },
      { status: 500 }
    );
  }
}
