import { createClient, SupabaseClient } from '@supabase/supabase-js';

const rawUrl = import.meta.env.VITE_SUPABASE_URL?.trim() || '';
const rawKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() || '';

const PLACEHOLDER_URLS = [
  '',
  'https://YOUR_PROJECT_ID.supabase.co',
  'https://your-project-id.supabase.co',
];

const PLACEHOLDER_KEYS = [
  '',
  'YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY',
  'your-anon-key',
];

export function isSupabaseConfigured(): boolean {
  if (!rawUrl || !rawKey) return false;
  if (PLACEHOLDER_URLS.includes(rawUrl) || PLACEHOLDER_KEYS.includes(rawKey)) return false;
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

export const supabaseConfigStatus = {
  isConfigured: isSupabaseConfigured(),
  url: isSupabaseConfigured() ? rawUrl : null,
  hasKey: isSupabaseConfigured() && rawKey.length > 20,
};

// สร้าง Client โดยใช้ URL จริง หรือ Fallback URL ที่ปลอดภัยเพื่อไม่ให้แอปพังก่อนแสดงหน้า Setup Guide
const effectiveUrl = isSupabaseConfigured() ? rawUrl : 'https://placeholder-unconfigured.supabase.co';
const effectiveKey = isSupabaseConfigured() ? rawKey : 'unconfigured-anon-key-placeholder';

export const supabase: SupabaseClient = createClient(effectiveUrl, effectiveKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

// สร้าง Client แยกที่ไม่เขียนทับ Session ปัจจุบัน (ใช้สำหรับกรณี Admin สร้างบัญชีให้บุคลากรใหม่)
export function createIsolatedAuthClient(): SupabaseClient {
  return createClient(effectiveUrl, effectiveKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: 'sb-isolated-admin-user-creator',
    },
  });
}

export function assertSupabaseConfigured(): void {
  if (!isSupabaseConfigured()) {
    throw new Error(
      'ยังไม่ได้ตั้งค่าการเชื่อมต่อฐานข้อมูล Supabase กรุณาตั้งค่า VITE_SUPABASE_URL และ VITE_SUPABASE_ANON_KEY ในไฟล์ .env.local ก่อนดำเนินการ'
    );
  }
}

export async function recordAuditLog(params: {
  action: string;
  entityType: string;
  entityId?: string | null;
  summary: string;
  beforeData?: Record<string, unknown> | null;
  afterData?: Record<string, unknown> | null;
}): Promise<void> {
  if (!isSupabaseConfigured()) return;
  try {
    await supabase.rpc('write_audit_log', {
      p_action: params.action,
      p_entity_type: params.entityType,
      p_entity_id: params.entityId || null,
      p_summary: params.summary,
      p_before_data: params.beforeData || null,
      p_after_data: params.afterData || null,
    });
  } catch (err) {
    console.warn('ไม่สามารถบันทึก Audit Log ผ่าน RPC ได้:', err);
  }
}
