import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import type { Database } from '@/types/database';

// Cliente para usar en Client Components (navegador)
export const createBrowserClient = () =>
  createClientComponentClient<Database>();
