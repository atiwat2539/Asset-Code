import { assertSupabaseConfigured, supabase } from './supabase';

export type StorageBucketName =
  | 'asset-images'
  | 'asset-documents'
  | 'maintenance-attachments'
  | 'disposal-attachments';

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const ALLOWED_DOC_TYPES = ['application/pdf', ...ALLOWED_IMAGE_TYPES];

const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_DOC_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * ทำให้ชื่อไฟล์ปลอดภัยสำหรับใช้ใน Storage Path
 * ป้องกัน Path Traversal (../), อักขระพิเศษ และใช้ UUID/Timestamp นำหน้าเสมอ
 */
export function sanitizeStorageFileName(originalName: string): string {
  const parts = originalName.split('.');
  const ext = parts.length > 1 ? parts.pop()!.toLowerCase().replace(/[^a-z0-9]/g, '') : 'bin';
  const base = parts
    .join('.')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 40)
    .replace(/^_|_$/g, '');

  const safeBase = base || 'file';
  return `${safeBase}.${ext || 'dat'}`;
}

export function validateUploadFile(file: File, bucket: StorageBucketName): void {
  const isImageBucket = bucket === 'asset-images';
  const allowedTypes = isImageBucket ? ALLOWED_IMAGE_TYPES : ALLOWED_DOC_TYPES;
  const maxSize = isImageBucket ? MAX_IMAGE_SIZE_BYTES : MAX_DOC_SIZE_BYTES;

  if (!allowedTypes.includes(file.type)) {
    throw new Error(
      isImageBucket
        ? 'อนุญาตเฉพาะไฟล์รูปภาพ JPG, PNG หรือ WEBP เท่านั้น'
        : 'อนุญาตเฉพาะไฟล์ PDF, JPG, PNG หรือ WEBP เท่านั้น'
    );
  }

  if (file.size > maxSize) {
    const maxMb = maxSize / (1024 * 1024);
    throw new Error(`ขนาดไฟล์เกินกำหนดสูงสุด (${maxMb} MB)`);
  }
}

export async function uploadFileToBucket(params: {
  bucket: StorageBucketName;
  folder: string;
  file: File;
  previousPath?: string | null;
}): Promise<{ path: string; publicUrl: string | null }> {
  assertSupabaseConfigured();
  validateUploadFile(params.file, params.bucket);

  const safeName = sanitizeStorageFileName(params.file.name);
  const uniquePrefix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const cleanFolder = params.folder.replace(/[^a-zA-Z0-9/_-]/g, '').replace(/^\/+|\/+$/g, '');
  const storagePath = cleanFolder ? `${cleanFolder}/${uniquePrefix}_${safeName}` : `${uniquePrefix}_${safeName}`;

  const { error: uploadError } = await supabase.storage
    .from(params.bucket)
    .upload(storagePath, params.file, {
      cacheControl: '3600',
      upsert: false,
      contentType: params.file.type,
    });

  if (uploadError) {
    throw uploadError;
  }

  // หากมีการแทนที่ไฟล์เดิม ให้ลบไฟล์เก่าตามสิทธิ์
  if (params.previousPath) {
    await supabase.storage.from(params.bucket).remove([params.previousPath]).catch((err) => {
      console.warn('ไม่สามารถลบไฟล์เดิมได้:', err);
    });
  }

  let publicUrl: string | null = null;
  if (params.bucket === 'asset-images') {
    const { data } = supabase.storage.from(params.bucket).getPublicUrl(storagePath);
    publicUrl = data.publicUrl;
  }

  return { path: storagePath, publicUrl };
}

/**
 * สร้าง Signed URL อายุสั้น (ค่าเริ่มต้น 300 วินาที = 5 นาที) สำหรับไฟล์ใน Private Bucket
 */
export async function getSignedFileUrl(
  bucket: StorageBucketName,
  filePath: string,
  expiresInSeconds = 300
): Promise<string> {
  assertSupabaseConfigured();

  if (bucket === 'asset-images') {
    const { data } = supabase.storage.from(bucket).getPublicUrl(filePath);
    return data.publicUrl;
  }

  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(filePath, expiresInSeconds);

  if (error || !data?.signedUrl) {
    throw error || new Error('ไม่สามารถสร้างลิงก์เข้าถึงไฟล์ชั่วคราวได้');
  }

  return data.signedUrl;
}
