import { createServerComponentClient, createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import type { Database } from '@/types/database';

// Cliente para usar en Server Components
export const createServerClient = () =>
  createServerComponentClient<Database>({ cookies });

// Cliente para usar en Route Handlers (app/api/**)
export const createRouteClient = () =>
  createRouteHandlerClient<Database>({ cookies });
