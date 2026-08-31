import { redirect } from 'next/navigation';
import { createServerClient } from '@/lib/supabaseServer';

export default async function RootPage() {
  const supabase = createServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  redirect(session ? '/dashboard' : '/login');
}
