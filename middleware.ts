import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createMiddlewareClient } from '@supabase/auth-helpers-nextjs';

// Mapa de qué prefijos de ruta puede visitar cada rol.
// El admin siempre tiene acceso a todo.
const ROLE_ROUTES: Record<string, string[]> = {
  admin: ['*'],
  almacenero: ['/dashboard', '/dashboard/almacen', '/dashboard/comercial', '/dashboard/pos', '/dashboard/pedidos-comerciales'],
  conductor: ['/dashboard', '/dashboard/conductor'],
  comercial: ['/dashboard', '/dashboard/comercial', '/dashboard/pos', '/dashboard/pedidos-comerciales'],
};

export async function middleware(req: NextRequest) {
  const res = NextResponse.next();
  const supabase = createMiddlewareClient({ req, res });

  const {
    data: { session },
  } = await supabase.auth.getSession();

  const pathname = req.nextUrl.pathname;
  const isAuthRoute = pathname.startsWith('/login');
  const isProtectedRoute = pathname.startsWith('/dashboard');

  if (!session && isProtectedRoute) {
    const redirectUrl = new URL('/login', req.url);
    return NextResponse.redirect(redirectUrl);
  }

  if (session && isAuthRoute) {
    return NextResponse.redirect(new URL('/dashboard', req.url));
  }

  if (session && isProtectedRoute) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', session.user.id)
      .single();

    if (!profile) {
      await supabase.auth.signOut();
      return NextResponse.redirect(new URL('/login', req.url));
    }

    const allowed = ROLE_ROUTES[profile.role] ?? [];
    const hasAccess =
      allowed.includes('*') ||
      allowed.some((prefix) => pathname === prefix || pathname.startsWith(prefix + '/'));

    if (!hasAccess) {
      return NextResponse.redirect(new URL('/dashboard', req.url));
    }
  }

  return res;
}

export const config = {
  matcher: ['/dashboard/:path*', '/login'],
};
