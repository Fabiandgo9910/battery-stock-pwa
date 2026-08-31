'use client';

import { useEffect, useState } from 'react';
import { createBrowserClient } from '@/lib/supabaseClient';
import type { Profile } from '@/types/domain';

export function useProfile() {
  const supabase = createBrowserClient();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    async function load() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        if (mounted) {
          setProfile(null);
          setLoading(false);
        }
        return;
      }
      const { data } = await supabase.from('profiles').select('*').eq('id', user.id).single();
      if (mounted) {
        setProfile(data as Profile);
        setLoading(false);
      }
    }
    load();
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { profile, loading };
}
