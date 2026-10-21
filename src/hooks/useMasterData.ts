import { useQuery } from '@tanstack/react-query';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import type { AssetCategory, Department, Location, Profile, SystemSettings } from '@/types/database';

export function useDepartments() {
  return useQuery({
    queryKey: ['departments'],
    queryFn: async () => {
      if (!isSupabaseConfigured()) return [] as Department[];
      const { data, error } = await supabase
        .from('departments')
        .select('*')
        .order('code', { ascending: true });
      if (error) throw error;
      return (data || []) as Department[];
    },
  });
}

export function useLocations() {
  return useQuery({
    queryKey: ['locations'],
    queryFn: async () => {
      if (!isSupabaseConfigured()) return [] as Location[];
      const { data, error } = await supabase
        .from('locations')
        .select('*, department:departments(*)')
        .order('building', { ascending: true });
      if (error) throw error;
      return (data || []) as Location[];
    },
  });
}

export function useCategories() {
  return useQuery({
    queryKey: ['asset_categories'],
    queryFn: async () => {
      if (!isSupabaseConfigured()) return [] as AssetCategory[];
      const { data, error } = await supabase
        .from('asset_categories')
        .select('*')
        .order('code', { ascending: true });
      if (error) throw error;
      return (data || []) as AssetCategory[];
    },
  });
}

export function useProfiles() {
  return useQuery({
    queryKey: ['profiles'],
    queryFn: async () => {
      if (!isSupabaseConfigured()) return [] as Profile[];
      const { data, error } = await supabase
        .from('profiles')
        .select('*, department:departments(*)')
        .order('full_name', { ascending: true });
      if (error) throw error;
      return (data || []) as Profile[];
    },
  });
}

export function useSystemSettings() {
  return useQuery({
    queryKey: ['system-settings'],
    queryFn: async () => {
      if (!isSupabaseConfigured()) return null;
      const { data, error } = await supabase
        .from('system_settings')
        .select('*')
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as SystemSettings | null;
    },
  });
}
