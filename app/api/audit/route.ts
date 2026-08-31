import { NextRequest, NextResponse } from 'next/server';
import { createRouteClient } from '@/lib/supabaseServer';

// GET /api/audit -> últimas 100 acciones registradas (solo admin)
export async function GET(req: NextRequest) {
  const supabase = createRouteClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', session.user.id).single();
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'No autorizado' }, { status: 403 });

  const table = req.nextUrl.searchParams.get('table');
  let query = supabase
    .from('audit_log')
    .select('*, user:profiles(full_name)')
    .order('created_at', { ascending: false })
    .limit(100);

  if (table) query = query.eq('table_name', table);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ logs: data });
}
