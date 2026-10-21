-- =============================================================================
-- Migration 00004: Supabase Storage Buckets และ Storage RLS Policies
-- สร้าง 4 Buckets ตามข้อกำหนด พร้อมจำกัดประเภทไฟล์และขนาดสูงสุด
-- =============================================================================

-- 1. สร้าง Buckets
-- asset-images: รูปภาพครุภัณฑ์ (อนุญาตเฉพาะ JPG, PNG, WEBP ขนาดไม่เกิน 5MB)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'asset-images',
  'asset-images',
  TRUE,
  5242880, -- 5 MB
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- asset-documents: เอกสารจัดซื้อ/ใบตรวจรับแบบ Private (ใช้ Signed URL ในการเปิดดู)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'asset-documents',
  'asset-documents',
  FALSE,
  10485760, -- 10 MB
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- maintenance-attachments: รูปภาพและเอกสารประกอบการแจ้งซ่อม (Private)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'maintenance-attachments',
  'maintenance-attachments',
  FALSE,
  10485760, -- 10 MB
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- disposal-attachments: เอกสารคณะกรรมการและหลักฐานการแทงจำหน่าย (Private)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'disposal-attachments',
  'disposal-attachments',
  FALSE,
  10485760, -- 10 MB
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- =============================================================================
-- 2. Storage RLS Policies บน storage.objects
-- =============================================================================

-- 2.1 asset-images: ผู้ใช้ที่เข้าสู่ระบบดูได้ทุกคน, อัปโหลด/ลบได้เฉพาะเจ้าหน้าที่พัสดุและ Admin
CREATE POLICY "asset_images_select"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'asset-images');

CREATE POLICY "asset_images_insert_staff"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'asset-images' AND public.is_staff_or_admin());

CREATE POLICY "asset_images_delete_staff"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'asset-images' AND public.is_staff_or_admin());

-- 2.2 asset-documents (Private): อ่าน/อัปโหลด/ลบได้เฉพาะเจ้าหน้าที่พัสดุและ Admin
CREATE POLICY "asset_documents_select_staff"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'asset-documents' AND public.is_staff_or_admin());

CREATE POLICY "asset_documents_insert_staff"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'asset-documents' AND public.is_staff_or_admin());

CREATE POLICY "asset_documents_delete_staff"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'asset-documents' AND public.is_staff_or_admin());

-- 2.3 maintenance-attachments (Private): ผู้ใช้ที่เข้าสู่ระบบอัปโหลดไฟล์แจ้งซ่อมได้, เปิดดูได้เฉพาะเจ้าของไฟล์หรือเจ้าหน้าที่พัสดุ
CREATE POLICY "maintenance_attachments_select"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'maintenance-attachments'
    AND (public.is_staff_or_admin() OR owner = auth.uid())
  );

CREATE POLICY "maintenance_attachments_insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'maintenance-attachments');

CREATE POLICY "maintenance_attachments_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'maintenance-attachments'
    AND (public.is_staff_or_admin() OR owner = auth.uid())
  );

-- 2.4 disposal-attachments (Private): เฉพาะเจ้าหน้าที่พัสดุและ Admin
CREATE POLICY "disposal_attachments_select_staff"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'disposal-attachments' AND public.is_staff_or_admin());

CREATE POLICY "disposal_attachments_insert_staff"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'disposal-attachments' AND public.is_staff_or_admin());

CREATE POLICY "disposal_attachments_delete_staff"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'disposal-attachments' AND public.is_staff_or_admin());
