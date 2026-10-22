-- ============================================================================
-- FULL SUPABASE SETUP SCRIPT (Schema + RLS + RPC + Storage + Seed Data)
-- คัดลอกไฟล์นี้ไปรันใน Supabase SQL Editor เพียงครั้งเดียวเพื่อติดตั้งฐานข้อมูลทั้งหมด
-- ============================================================================

-- >>> START OF supabase/migrations/00001_initial_schema.sql <<<
-- =============================================================================
-- Migration 00001: โครงสร้างฐานข้อมูลระบบบริหารจัดการครุภัณฑ์สำนักงานหน่วยงานราชการ
-- ครอบคลุม 18 ตารางหลัก, Constraints, Indexes และ Triggers
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ฟังก์ชันมาตรฐานสำหรับอัปเดตคอลัมน์ updated_at อัตโนมัติ
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- =============================================================================
-- 1. departments (หน่วยงาน/กอง/สำนัก/ฝ่าย)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  parent_id UUID REFERENCES public.departments(id) ON DELETE SET NULL,
  phone TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_departments_code ON public.departments(code);
CREATE INDEX IF NOT EXISTS idx_departments_is_active ON public.departments(is_active);

DROP TRIGGER IF EXISTS trg_departments_updated_at ON public.departments;
CREATE TRIGGER trg_departments_updated_at
  BEFORE UPDATE ON public.departments
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- =============================================================================
-- 2. locations (อาคาร ชั้น ห้อง และสถานที่ตั้ง)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id UUID REFERENCES public.departments(id) ON DELETE SET NULL,
  code TEXT NOT NULL UNIQUE,
  building TEXT NOT NULL,
  floor TEXT,
  room TEXT,
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_locations_department_id ON public.locations(department_id);
CREATE INDEX IF NOT EXISTS idx_locations_building_room ON public.locations(building, room);

DROP TRIGGER IF EXISTS trg_locations_updated_at ON public.locations;
CREATE TRIGGER trg_locations_updated_at
  BEFORE UPDATE ON public.locations
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- =============================================================================
-- 3. profiles (โปรไฟล์ผู้ใช้ เชื่อมกับ auth.users)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'requester' CHECK (role IN ('admin', 'asset_officer', 'requester')),
  department_id UUID REFERENCES public.departments(id) ON DELETE SET NULL,
  position TEXT,
  phone TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles(role);
CREATE INDEX IF NOT EXISTS idx_profiles_department_id ON public.profiles(department_id);

DROP TRIGGER IF EXISTS trg_profiles_updated_at ON public.profiles;
CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Trigger สร้างโปรไฟล์อัตโนมัติเมื่อมีผู้ใช้ใหม่ใน auth.users (บังคับ role เริ่มต้นเป็น requester เสมอ)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(COALESCE(NEW.email, 'user'), '@', 1)),
    'requester'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =============================================================================
-- 4. asset_categories (หมวดหมู่ครุภัณฑ์ตามมาตรฐานพัสดุ)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.asset_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  useful_life_years INTEGER NOT NULL DEFAULT 5 CHECK (useful_life_years >= 1 AND useful_life_years <= 50),
  depreciation_rate NUMERIC(5,2) NOT NULL DEFAULT 20.00 CHECK (depreciation_rate >= 0 AND depreciation_rate <= 100),
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_asset_categories_code ON public.asset_categories(code);

DROP TRIGGER IF EXISTS trg_asset_categories_updated_at ON public.asset_categories;
CREATE TRIGGER trg_asset_categories_updated_at
  BEFORE UPDATE ON public.asset_categories
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- =============================================================================
-- 5. assets (ทะเบียนครุภัณฑ์หลัก)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category_id UUID NOT NULL REFERENCES public.asset_categories(id) ON DELETE RESTRICT,
  brand TEXT,
  model TEXT,
  serial_number TEXT,
  description TEXT,
  unit_price NUMERIC(15,2) NOT NULL DEFAULT 0.00 CHECK (unit_price >= 0),
  acquired_date DATE NOT NULL,
  contract_number TEXT,
  useful_life_years INTEGER CHECK (useful_life_years IS NULL OR (useful_life_years >= 1 AND useful_life_years <= 50)),
  status TEXT NOT NULL DEFAULT 'available' CHECK (
    status IN ('available', 'borrowed', 'under_maintenance', 'pending_disposal', 'disposed', 'lost')
  ),
  department_id UUID NOT NULL REFERENCES public.departments(id) ON DELETE RESTRICT,
  location_id UUID REFERENCES public.locations(id) ON DELETE SET NULL,
  custodian_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  image_url TEXT,
  notes TEXT,
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assets_asset_code ON public.assets(asset_code);
CREATE INDEX IF NOT EXISTS idx_assets_name ON public.assets(name);
CREATE INDEX IF NOT EXISTS idx_assets_category_id ON public.assets(category_id);
CREATE INDEX IF NOT EXISTS idx_assets_status ON public.assets(status);
CREATE INDEX IF NOT EXISTS idx_assets_department_id ON public.assets(department_id);
CREATE INDEX IF NOT EXISTS idx_assets_location_id ON public.assets(location_id);
CREATE INDEX IF NOT EXISTS idx_assets_custodian_id ON public.assets(custodian_id);
CREATE INDEX IF NOT EXISTS idx_assets_acquired_date ON public.assets(acquired_date);

DROP TRIGGER IF EXISTS trg_assets_updated_at ON public.assets;
CREATE TRIGGER trg_assets_updated_at
  BEFORE UPDATE ON public.assets
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- =============================================================================
-- 6. asset_attachments (รูปภาพและเอกสารแนบครุภัณฑ์)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.asset_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id UUID NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_size BIGINT NOT NULL CHECK (file_size >= 0),
  bucket_name TEXT NOT NULL CHECK (bucket_name IN ('asset-images', 'asset-documents', 'maintenance-attachments', 'disposal-attachments')),
  category TEXT NOT NULL DEFAULT 'general' CHECK (category IN ('image', 'procurement', 'inspection', 'warranty', 'manual', 'general')),
  uploaded_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_asset_attachments_asset_id ON public.asset_attachments(asset_id);

-- =============================================================================
-- 7. asset_transfers (คำขอและประวัติการโอนย้ายสถานที่/ผู้รับผิดชอบ)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.asset_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_no TEXT NOT NULL UNIQUE,
  asset_id UUID NOT NULL REFERENCES public.assets(id) ON DELETE RESTRICT,
  from_department_id UUID REFERENCES public.departments(id) ON DELETE SET NULL,
  to_department_id UUID NOT NULL REFERENCES public.departments(id) ON DELETE RESTRICT,
  from_location_id UUID REFERENCES public.locations(id) ON DELETE SET NULL,
  to_location_id UUID REFERENCES public.locations(id) ON DELETE SET NULL,
  from_custodian_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  to_custodian_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  effective_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  requested_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  approved_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  rejection_reason TEXT,
  attachment_path TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_asset_transfers_asset_id ON public.asset_transfers(asset_id);
CREATE INDEX IF NOT EXISTS idx_asset_transfers_status ON public.asset_transfers(status);

DROP TRIGGER IF EXISTS trg_asset_transfers_updated_at ON public.asset_transfers;
CREATE TRIGGER trg_asset_transfers_updated_at
  BEFORE UPDATE ON public.asset_transfers
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- =============================================================================
-- 8. borrow_requests (คำขอยืมครุภัณฑ์)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.borrow_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_no TEXT NOT NULL UNIQUE,
  asset_id UUID NOT NULL REFERENCES public.assets(id) ON DELETE RESTRICT,
  requester_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  department_id UUID REFERENCES public.departments(id) ON DELETE SET NULL,
  purpose TEXT NOT NULL,
  borrow_date DATE NOT NULL,
  expected_return_date DATE NOT NULL,
  actual_pickup_date TIMESTAMPTZ,
  actual_return_date TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'approved', 'rejected', 'borrowed', 'returned', 'overdue', 'cancelled')
  ),
  approved_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  rejection_reason TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_borrow_dates CHECK (expected_return_date >= borrow_date)
);

CREATE INDEX IF NOT EXISTS idx_borrow_requests_asset_id ON public.borrow_requests(asset_id);
CREATE INDEX IF NOT EXISTS idx_borrow_requests_requester_id ON public.borrow_requests(requester_id);
CREATE INDEX IF NOT EXISTS idx_borrow_requests_status ON public.borrow_requests(status);
CREATE INDEX IF NOT EXISTS idx_borrow_requests_expected_return ON public.borrow_requests(expected_return_date);

DROP TRIGGER IF EXISTS trg_borrow_requests_updated_at ON public.borrow_requests;
CREATE TRIGGER trg_borrow_requests_updated_at
  BEFORE UPDATE ON public.borrow_requests
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- =============================================================================
-- 9. borrow_transactions (ประวัติการจ่ายครุภัณฑ์และรับคืนจริง)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.borrow_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  borrow_request_id UUID NOT NULL REFERENCES public.borrow_requests(id) ON DELETE RESTRICT,
  asset_id UUID NOT NULL REFERENCES public.assets(id) ON DELETE RESTRICT,
  action_type TEXT NOT NULL CHECK (action_type IN ('checkout', 'checkin')),
  action_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  handled_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  borrower_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  asset_condition TEXT NOT NULL DEFAULT 'normal' CHECK (asset_condition IN ('normal', 'minor_damage', 'damaged', 'lost')),
  condition_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_borrow_transactions_request_id ON public.borrow_transactions(borrow_request_id);
CREATE INDEX IF NOT EXISTS idx_borrow_transactions_asset_id ON public.borrow_transactions(asset_id);

-- =============================================================================
-- 10. maintenance_requests (ใบแจ้งซ่อมและบำรุงรักษา)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.maintenance_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_no TEXT NOT NULL UNIQUE,
  asset_id UUID NOT NULL REFERENCES public.assets(id) ON DELETE RESTRICT,
  reported_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  reported_date DATE NOT NULL DEFAULT CURRENT_DATE,
  issue_description TEXT NOT NULL,
  urgency TEXT NOT NULL DEFAULT 'medium' CHECK (urgency IN ('low', 'medium', 'high', 'critical')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'approved', 'in_progress', 'waiting_parts', 'completed', 'unrepairable', 'cancelled')
  ),
  assigned_to UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  vendor_name TEXT,
  estimated_cost NUMERIC(15,2) NOT NULL DEFAULT 0.00 CHECK (estimated_cost >= 0),
  actual_cost NUMERIC(15,2) NOT NULL DEFAULT 0.00 CHECK (actual_cost >= 0),
  sent_date DATE,
  completed_date DATE,
  resolution_notes TEXT,
  attachment_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_maintenance_requests_asset_id ON public.maintenance_requests(asset_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_requests_status ON public.maintenance_requests(status);
CREATE INDEX IF NOT EXISTS idx_maintenance_requests_reported_by ON public.maintenance_requests(reported_by);

DROP TRIGGER IF EXISTS trg_maintenance_requests_updated_at ON public.maintenance_requests;
CREATE TRIGGER trg_maintenance_requests_updated_at
  BEFORE UPDATE ON public.maintenance_requests
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- =============================================================================
-- 11. maintenance_logs (ประวัติการดำเนินงานซ่อมและค่าใช้จ่ายรายครั้ง)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.maintenance_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  maintenance_request_id UUID NOT NULL REFERENCES public.maintenance_requests(id) ON DELETE RESTRICT,
  asset_id UUID NOT NULL REFERENCES public.assets(id) ON DELETE RESTRICT,
  action_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status_from TEXT,
  status_to TEXT NOT NULL,
  cost NUMERIC(15,2) NOT NULL DEFAULT 0.00 CHECK (cost >= 0),
  vendor_name TEXT,
  description TEXT NOT NULL,
  performed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_maintenance_logs_request_id ON public.maintenance_logs(maintenance_request_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_logs_asset_id ON public.maintenance_logs(asset_id);

-- =============================================================================
-- 12. inventory_sessions (รอบตรวจนับครุภัณฑ์ประจำปี)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.inventory_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  fiscal_year INTEGER NOT NULL CHECK (fiscal_year >= 2500 AND fiscal_year <= 2700),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  department_id UUID REFERENCES public.departments(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('draft', 'in_progress', 'completed', 'cancelled')),
  responsible_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  notes TEXT,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_inventory_dates CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_inventory_sessions_fiscal_year ON public.inventory_sessions(fiscal_year);
CREATE INDEX IF NOT EXISTS idx_inventory_sessions_status ON public.inventory_sessions(status);

DROP TRIGGER IF EXISTS trg_inventory_sessions_updated_at ON public.inventory_sessions;
CREATE TRIGGER trg_inventory_sessions_updated_at
  BEFORE UPDATE ON public.inventory_sessions
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- =============================================================================
-- 13. inventory_items (ผลการตรวจนับรายครุภัณฑ์)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.inventory_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.inventory_sessions(id) ON DELETE CASCADE,
  asset_id UUID NOT NULL REFERENCES public.assets(id) ON DELETE RESTRICT,
  expected_location_id UUID REFERENCES public.locations(id) ON DELETE SET NULL,
  actual_location_id UUID REFERENCES public.locations(id) ON DELETE SET NULL,
  result_status TEXT NOT NULL CHECK (
    result_status IN ('found_normal', 'not_found', 'found_mismatch', 'damaged', 'needs_review')
  ),
  inspected_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  inspected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes TEXT,
  evidence_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_inventory_session_asset UNIQUE (session_id, asset_id)
);

CREATE INDEX IF NOT EXISTS idx_inventory_items_session_id ON public.inventory_items(session_id);
CREATE INDEX IF NOT EXISTS idx_inventory_items_asset_id ON public.inventory_items(asset_id);
CREATE INDEX IF NOT EXISTS idx_inventory_items_result_status ON public.inventory_items(result_status);

DROP TRIGGER IF EXISTS trg_inventory_items_updated_at ON public.inventory_items;
CREATE TRIGGER trg_inventory_items_updated_at
  BEFORE UPDATE ON public.inventory_items
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- =============================================================================
-- 14. disposal_requests (คำขอจำหน่าย/แทงจำหน่ายครุภัณฑ์)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.disposal_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  disposal_no TEXT NOT NULL UNIQUE,
  asset_id UUID NOT NULL REFERENCES public.assets(id) ON DELETE RESTRICT,
  reason_type TEXT NOT NULL CHECK (reason_type IN ('deteriorated', 'damaged_beyond_repair', 'obsolete', 'lost', 'other')),
  reason_detail TEXT NOT NULL,
  proposed_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  proposed_date DATE NOT NULL DEFAULT CURRENT_DATE,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (
    status IN ('draft', 'submitted', 'under_review', 'approved', 'rejected', 'disposed')
  ),
  reviewed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  approved_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  document_no TEXT,
  disposal_date DATE,
  disposal_method TEXT CHECK (disposal_method IS NULL OR disposal_method IN ('sale', 'transfer_out', 'destroy', 'write_off')),
  salvage_value NUMERIC(15,2) NOT NULL DEFAULT 0.00 CHECK (salvage_value >= 0),
  attachment_path TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_disposal_requests_asset_id ON public.disposal_requests(asset_id);
CREATE INDEX IF NOT EXISTS idx_disposal_requests_status ON public.disposal_requests(status);

DROP TRIGGER IF EXISTS trg_disposal_requests_updated_at ON public.disposal_requests;
CREATE TRIGGER trg_disposal_requests_updated_at
  BEFORE UPDATE ON public.disposal_requests
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- =============================================================================
-- 15. corporate_events (ปฏิทินกิจกรรมองค์กรและกำหนดการพัสดุ)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.corporate_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL DEFAULT 'general' CHECK (
    category IN ('meeting', 'inventory', 'maintenance', 'training', 'due_date', 'general')
  ),
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  all_day BOOLEAN NOT NULL DEFAULT FALSE,
  location TEXT,
  organizer_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  participants TEXT,
  related_entity_type TEXT,
  related_entity_id UUID,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_event_dates CHECK (end_at >= start_at)
);

CREATE INDEX IF NOT EXISTS idx_corporate_events_start_at ON public.corporate_events(start_at);
CREATE INDEX IF NOT EXISTS idx_corporate_events_category ON public.corporate_events(category);

DROP TRIGGER IF EXISTS trg_corporate_events_updated_at ON public.corporate_events;
CREATE TRIGGER trg_corporate_events_updated_at
  BEFORE UPDATE ON public.corporate_events
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- =============================================================================
-- 16. system_settings (การตั้งค่าระบบที่ไม่ใช่ข้อมูลลับ)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.system_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_name TEXT NOT NULL DEFAULT 'สำนักงานบริหารงานพัสดุและครุภัณฑ์กลาง',
  org_short_name TEXT NOT NULL DEFAULT 'สบพ.',
  org_address TEXT DEFAULT 'ถนนแจ้งวัฒนะ เขตหลักสี่ กรุงเทพมหานคร 10210',
  org_phone TEXT DEFAULT '02-000-0000',
  org_email TEXT DEFAULT 'saraban@agency.go.th',
  logo_url TEXT,
  asset_code_prefix TEXT NOT NULL DEFAULT 'กพ 01',
  asset_code_format TEXT NOT NULL DEFAULT '{PREFIX}-{CATEGORY}-{YEAR}-{SEQ4}',
  current_fiscal_year INTEGER NOT NULL DEFAULT 2569,
  borrow_reminder_days INTEGER NOT NULL DEFAULT 3 CHECK (borrow_reminder_days >= 1 AND borrow_reminder_days <= 30),
  timezone TEXT NOT NULL DEFAULT 'Asia/Bangkok',
  date_format TEXT NOT NULL DEFAULT 'dd MMM BBBB',
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- 17. audit_logs (ประวัติการดำเนินการสำคัญ ห้ามแก้ไขหรือลบผ่าน Client)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  actor_email TEXT,
  actor_role TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  summary TEXT NOT NULL,
  before_data JSONB,
  after_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON public.audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_id ON public.audit_logs(actor_id);

-- =============================================================================
-- 18. notifications (รายการแจ้งเตือนสำหรับผู้ใช้)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'info' CHECK (type IN ('info', 'warning', 'success', 'urgent')),
  related_entity_type TEXT,
  related_entity_id UUID,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON public.notifications(user_id, is_read);


-- >>> START OF supabase/migrations/00002_rls_policies.sql <<<
-- =============================================================================
-- Migration 00002: Row Level Security (RLS) และการป้องกันการยกระดับสิทธิ์ด้วยตนเอง
-- =============================================================================

-- 1. ฟังก์ชันตรวจสอบบทบาทของผู้ใช้ปัจจุบันจากตาราง profiles โดยตรง (ไม่พึ่งพา Client/LocalStorage)
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT role FROM public.profiles WHERE id = auth.uid() AND is_active = TRUE),
    'anonymous'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.get_my_role() = 'admin';
$$;

CREATE OR REPLACE FUNCTION public.is_staff_or_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.get_my_role() IN ('admin', 'asset_officer');
$$;

-- 2. Trigger ป้องกันผู้ใช้ที่ไม่ใช่ Admin แก้ไขคอลัมน์ role หรือสถานะ is_active ของตนเอง
CREATE OR REPLACE FUNCTION public.prevent_role_escalation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (NEW.role IS DISTINCT FROM OLD.role OR NEW.is_active IS DISTINCT FROM OLD.is_active) THEN
    -- อนุญาตเฉพาะกรณีที่ผู้เรียกเป็น Admin หรือเป็นการรันผ่าน SQL Editor / Server-side (auth.uid() IS NULL)
    IF auth.uid() IS NOT NULL AND NOT public.is_admin() THEN
      RAISE EXCEPTION 'ไม่อนุญาตให้แก้ไขระดับสิทธิ์ (Role) หรือสถานะบัญชีด้วยตนเอง';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_role_escalation ON public.profiles;
CREATE TRIGGER trg_prevent_role_escalation
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.prevent_role_escalation();

-- =============================================================================
-- 3. เปิดใช้งาน Row Level Security (RLS) บนทุกตาราง
-- =============================================================================
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.borrow_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.borrow_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.disposal_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.corporate_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- 4. RLS Policies สำหรับแต่ละตาราง
-- =============================================================================

-- 4.1 departments (อ่านได้ทุกคนที่เข้าสู่ระบบ, แก้ไขได้เฉพาะ admin และ asset_officer)
CREATE POLICY "departments_select_authenticated"
  ON public.departments FOR SELECT
  TO authenticated
  USING (TRUE);

CREATE POLICY "departments_write_staff"
  ON public.departments FOR ALL
  TO authenticated
  USING (public.is_staff_or_admin())
  WITH CHECK (public.is_staff_or_admin());

-- 4.2 locations (อ่านได้ทุกคนที่เข้าสู่ระบบ, แก้ไขได้เฉพาะ admin และ asset_officer)
CREATE POLICY "locations_select_authenticated"
  ON public.locations FOR SELECT
  TO authenticated
  USING (TRUE);

CREATE POLICY "locations_write_staff"
  ON public.locations FOR ALL
  TO authenticated
  USING (public.is_staff_or_admin())
  WITH CHECK (public.is_staff_or_admin());

-- 4.3 profiles
CREATE POLICY "profiles_select_authenticated"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (TRUE);

CREATE POLICY "profiles_update_own_or_admin"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (id = auth.uid() OR public.is_admin())
  WITH CHECK (id = auth.uid() OR public.is_admin());

CREATE POLICY "profiles_insert_admin"
  ON public.profiles FOR INSERT
  TO authenticated
  WITH CHECK (id = auth.uid() OR public.is_admin());

-- 4.4 asset_categories
CREATE POLICY "categories_select_authenticated"
  ON public.asset_categories FOR SELECT
  TO authenticated
  USING (TRUE);

CREATE POLICY "categories_write_staff"
  ON public.asset_categories FOR ALL
  TO authenticated
  USING (public.is_staff_or_admin())
  WITH CHECK (public.is_staff_or_admin());

-- 4.5 assets (ผู้ใช้ทุกคนที่ Login ดูทะเบียนครุภัณฑ์ได้, เพิ่ม/แก้ไขได้เฉพาะ admin และ asset_officer, ลบจริงได้เฉพาะ admin)
CREATE POLICY "assets_select_authenticated"
  ON public.assets FOR SELECT
  TO authenticated
  USING (TRUE);

CREATE POLICY "assets_insert_staff"
  ON public.assets FOR INSERT
  TO authenticated
  WITH CHECK (public.is_staff_or_admin());

CREATE POLICY "assets_update_staff"
  ON public.assets FOR UPDATE
  TO authenticated
  USING (public.is_staff_or_admin())
  WITH CHECK (public.is_staff_or_admin());

CREATE POLICY "assets_delete_admin"
  ON public.assets FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- 4.6 asset_attachments
CREATE POLICY "attachments_select_authenticated"
  ON public.asset_attachments FOR SELECT
  TO authenticated
  USING (
    bucket_name = 'asset-images'
    OR public.is_staff_or_admin()
    OR uploaded_by = auth.uid()
  );

CREATE POLICY "attachments_insert_authenticated"
  ON public.asset_attachments FOR INSERT
  TO authenticated
  WITH CHECK (public.is_staff_or_admin() OR uploaded_by = auth.uid());

CREATE POLICY "attachments_delete_staff"
  ON public.asset_attachments FOR DELETE
  TO authenticated
  USING (public.is_staff_or_admin() OR uploaded_by = auth.uid());

-- 4.7 asset_transfers
CREATE POLICY "transfers_select_authenticated"
  ON public.asset_transfers FOR SELECT
  TO authenticated
  USING (
    public.is_staff_or_admin()
    OR requested_by = auth.uid()
    OR from_custodian_id = auth.uid()
    OR to_custodian_id = auth.uid()
  );

CREATE POLICY "transfers_insert_authenticated"
  ON public.asset_transfers FOR INSERT
  TO authenticated
  WITH CHECK (public.is_staff_or_admin() OR requested_by = auth.uid());

CREATE POLICY "transfers_update_staff"
  ON public.asset_transfers FOR UPDATE
  TO authenticated
  USING (public.is_staff_or_admin())
  WITH CHECK (public.is_staff_or_admin());

-- 4.8 borrow_requests
CREATE POLICY "borrow_requests_select"
  ON public.borrow_requests FOR SELECT
  TO authenticated
  USING (public.is_staff_or_admin() OR requester_id = auth.uid());

CREATE POLICY "borrow_requests_insert"
  ON public.borrow_requests FOR INSERT
  TO authenticated
  WITH CHECK (requester_id = auth.uid() OR public.is_staff_or_admin());

CREATE POLICY "borrow_requests_update"
  ON public.borrow_requests FOR UPDATE
  TO authenticated
  USING (
    public.is_staff_or_admin()
    OR (requester_id = auth.uid() AND status = 'pending')
  )
  WITH CHECK (
    public.is_staff_or_admin()
    OR (requester_id = auth.uid() AND status IN ('pending', 'cancelled'))
  );

-- 4.9 borrow_transactions
CREATE POLICY "borrow_transactions_select"
  ON public.borrow_transactions FOR SELECT
  TO authenticated
  USING (
    public.is_staff_or_admin()
    OR borrower_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.borrow_requests br
      WHERE br.id = borrow_request_id AND br.requester_id = auth.uid()
    )
  );

CREATE POLICY "borrow_transactions_insert_staff"
  ON public.borrow_transactions FOR INSERT
  TO authenticated
  WITH CHECK (public.is_staff_or_admin());

-- 4.10 maintenance_requests
CREATE POLICY "maintenance_requests_select"
  ON public.maintenance_requests FOR SELECT
  TO authenticated
  USING (public.is_staff_or_admin() OR reported_by = auth.uid() OR assigned_to = auth.uid());

CREATE POLICY "maintenance_requests_insert"
  ON public.maintenance_requests FOR INSERT
  TO authenticated
  WITH CHECK (reported_by = auth.uid() OR public.is_staff_or_admin());

CREATE POLICY "maintenance_requests_update"
  ON public.maintenance_requests FOR UPDATE
  TO authenticated
  USING (public.is_staff_or_admin() OR (reported_by = auth.uid() AND status = 'pending'))
  WITH CHECK (public.is_staff_or_admin() OR (reported_by = auth.uid() AND status IN ('pending', 'cancelled')));

-- 4.11 maintenance_logs
CREATE POLICY "maintenance_logs_select"
  ON public.maintenance_logs FOR SELECT
  TO authenticated
  USING (
    public.is_staff_or_admin()
    OR EXISTS (
      SELECT 1 FROM public.maintenance_requests mr
      WHERE mr.id = maintenance_request_id AND mr.reported_by = auth.uid()
    )
  );

CREATE POLICY "maintenance_logs_insert_staff"
  ON public.maintenance_logs FOR INSERT
  TO authenticated
  WITH CHECK (public.is_staff_or_admin());

-- 4.12 inventory_sessions & inventory_items
CREATE POLICY "inventory_sessions_select"
  ON public.inventory_sessions FOR SELECT
  TO authenticated
  USING (TRUE);

CREATE POLICY "inventory_sessions_write_staff"
  ON public.inventory_sessions FOR ALL
  TO authenticated
  USING (public.is_staff_or_admin())
  WITH CHECK (public.is_staff_or_admin());

CREATE POLICY "inventory_items_select"
  ON public.inventory_items FOR SELECT
  TO authenticated
  USING (TRUE);

CREATE POLICY "inventory_items_write_staff"
  ON public.inventory_items FOR ALL
  TO authenticated
  USING (public.is_staff_or_admin())
  WITH CHECK (public.is_staff_or_admin());

-- 4.13 disposal_requests
CREATE POLICY "disposal_requests_select"
  ON public.disposal_requests FOR SELECT
  TO authenticated
  USING (public.is_staff_or_admin() OR proposed_by = auth.uid());

CREATE POLICY "disposal_requests_insert_staff"
  ON public.disposal_requests FOR INSERT
  TO authenticated
  WITH CHECK (public.is_staff_or_admin());

CREATE POLICY "disposal_requests_update_staff"
  ON public.disposal_requests FOR UPDATE
  TO authenticated
  USING (public.is_staff_or_admin())
  WITH CHECK (public.is_staff_or_admin());

-- 4.14 corporate_events
CREATE POLICY "corporate_events_select"
  ON public.corporate_events FOR SELECT
  TO authenticated
  USING (TRUE);

CREATE POLICY "corporate_events_insert"
  ON public.corporate_events FOR INSERT
  TO authenticated
  WITH CHECK (public.is_staff_or_admin() OR organizer_id = auth.uid());

CREATE POLICY "corporate_events_update"
  ON public.corporate_events FOR UPDATE
  TO authenticated
  USING (public.is_staff_or_admin() OR organizer_id = auth.uid())
  WITH CHECK (public.is_staff_or_admin() OR organizer_id = auth.uid());

CREATE POLICY "corporate_events_delete"
  ON public.corporate_events FOR DELETE
  TO authenticated
  USING (public.is_staff_or_admin() OR organizer_id = auth.uid());

-- 4.15 system_settings
CREATE POLICY "system_settings_select"
  ON public.system_settings FOR SELECT
  TO authenticated
  USING (TRUE);

CREATE POLICY "system_settings_write_admin"
  ON public.system_settings FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- 4.16 audit_logs (อ่านได้เฉพาะ admin และ asset_officer, เพิ่มได้ผ่านฟังก์ชัน/ผู้ใช้ที่ login แต่ห้าม UPDATE หรือ DELETE เด็ดขาด)
CREATE POLICY "audit_logs_select_staff"
  ON public.audit_logs FOR SELECT
  TO authenticated
  USING (public.is_staff_or_admin() OR actor_id = auth.uid());

CREATE POLICY "audit_logs_insert_authenticated"
  ON public.audit_logs FOR INSERT
  TO authenticated
  WITH CHECK (actor_id = auth.uid() OR public.is_staff_or_admin());

-- ไม่มี Policy สำหรับ UPDATE และ DELETE บน audit_logs เพื่อบังคับ Immutable Audit Trail

-- 4.17 notifications
CREATE POLICY "notifications_select_own"
  ON public.notifications FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "notifications_update_own"
  ON public.notifications FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "notifications_insert_authenticated"
  ON public.notifications FOR INSERT
  TO authenticated
  WITH CHECK (public.is_staff_or_admin() OR user_id = auth.uid());


-- >>> START OF supabase/migrations/00003_rpc_functions.sql <<<
-- =============================================================================
-- Migration 00003: Database Functions & Atomic RPC Transactions
-- รองรับการทำงานหลายตารางใน Transaction เดียวกัน พร้อมบันทึก Audit Log อัตโนมัติ
-- =============================================================================

-- 1. ฟังก์ชันบันทึก Audit Log จากภายใน Database Function
CREATE OR REPLACE FUNCTION public.write_audit_log(
  p_action TEXT,
  p_entity_type TEXT,
  p_entity_id TEXT,
  p_summary TEXT,
  p_before_data JSONB DEFAULT NULL,
  p_after_data JSONB DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile RECORD;
  v_log_id UUID;
BEGIN
  SELECT id, email, role INTO v_profile
  FROM public.profiles
  WHERE id = auth.uid();

  INSERT INTO public.audit_logs (
    actor_id,
    actor_email,
    actor_role,
    action,
    entity_type,
    entity_id,
    summary,
    before_data,
    after_data
  )
  VALUES (
    v_profile.id,
    v_profile.email,
    v_profile.role,
    p_action,
    p_entity_type,
    p_entity_id,
    p_summary,
    p_before_data,
    p_after_data
  )
  RETURNING id INTO v_log_id;

  RETURN v_log_id;
END;
$$;

-- 2. RPC: อนุมัติหรือปฏิเสธการโอนย้ายครุภัณฑ์ พร้อมอัปเดตตาราง assets ใน Transaction เดียวกัน
CREATE OR REPLACE FUNCTION public.approve_asset_transfer(
  p_transfer_id UUID,
  p_approved BOOLEAN,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_transfer RECORD;
  v_asset RECORD;
BEGIN
  IF NOT public.is_staff_or_admin() THEN
    RAISE EXCEPTION 'เฉพาะผู้ดูแลระบบหรือเจ้าหน้าที่พัสดุเท่านั้นที่มีสิทธิ์อนุมัติการโอนย้าย';
  END IF;

  SELECT * INTO v_transfer
  FROM public.asset_transfers
  WHERE id = p_transfer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ไม่พบรายการคำขอโอนย้ายที่ระบุ';
  END IF;

  IF v_transfer.status <> 'pending' THEN
    RAISE EXCEPTION 'คำขอโอนย้ายนี้ได้รับการดำเนินการไปแล้ว (สถานะปัจจุบัน: %)', v_transfer.status;
  END IF;

  SELECT * INTO v_asset
  FROM public.assets
  WHERE id = v_transfer.asset_id
  FOR UPDATE;

  IF p_approved THEN
    -- อัปเดตสถานะใบโอนย้าย
    UPDATE public.asset_transfers
    SET
      status = 'approved',
      approved_by = auth.uid(),
      approved_at = NOW(),
      notes = COALESCE(p_reason, notes),
      updated_at = NOW()
    WHERE id = p_transfer_id;

    -- อัปเดตข้อมูลปัจจุบันของครุภัณฑ์ใน Transaction เดียวกัน
    UPDATE public.assets
    SET
      department_id = v_transfer.to_department_id,
      location_id = v_transfer.to_location_id,
      custodian_id = v_transfer.to_custodian_id,
      updated_by = auth.uid(),
      updated_at = NOW()
    WHERE id = v_transfer.asset_id;

    PERFORM public.write_audit_log(
      'TRANSFER_APPROVED',
      'asset_transfers',
      p_transfer_id::TEXT,
      format('อนุมัติโอนย้ายครุภัณฑ์ %s (เลขที่ %s)', v_asset.asset_code, v_transfer.transfer_no),
      jsonb_build_object(
        'department_id', v_asset.department_id,
        'location_id', v_asset.location_id,
        'custodian_id', v_asset.custodian_id
      ),
      jsonb_build_object(
        'department_id', v_transfer.to_department_id,
        'location_id', v_transfer.to_location_id,
        'custodian_id', v_transfer.to_custodian_id
      )
    );
  ELSE
    UPDATE public.asset_transfers
    SET
      status = 'rejected',
      approved_by = auth.uid(),
      approved_at = NOW(),
      rejection_reason = COALESCE(p_reason, 'ไม่อนุมัติ'),
      updated_at = NOW()
    WHERE id = p_transfer_id;

    PERFORM public.write_audit_log(
      'TRANSFER_REJECTED',
      'asset_transfers',
      p_transfer_id::TEXT,
      format('ปฏิเสธคำขอโอนย้ายครุภัณฑ์ %s (เลขที่ %s)', v_asset.asset_code, v_transfer.transfer_no),
      jsonb_build_object('status', 'pending'),
      jsonb_build_object('status', 'rejected', 'rejection_reason', p_reason)
    );
  END IF;

  RETURN jsonb_build_object('success', TRUE, 'transfer_id', p_transfer_id, 'status', CASE WHEN p_approved THEN 'approved' ELSE 'rejected' END);
END;
$$;

-- 3. RPC: จัดการขั้นตอนการยืม-คืน (อนุมัติ, ปฏิเสธ, ส่งมอบของ, รับคืนของ) พร้อมปรับสถานะครุภัณฑ์
CREATE OR REPLACE FUNCTION public.process_borrow_workflow(
  p_request_id UUID,
  p_action TEXT, -- 'approve', 'reject', 'checkout', 'checkin'
  p_notes TEXT DEFAULT NULL,
  p_condition TEXT DEFAULT 'normal'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req RECORD;
  v_asset RECORD;
  v_new_asset_status TEXT;
BEGIN
  IF NOT public.is_staff_or_admin() THEN
    RAISE EXCEPTION 'เฉพาะผู้ดูแลระบบหรือเจ้าหน้าที่พัสดุเท่านั้นที่มีสิทธิ์ดำเนินการยืม-คืน';
  END IF;

  SELECT * INTO v_req
  FROM public.borrow_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ไม่พบคำขอยืมครุภัณฑ์ที่ระบุ';
  END IF;

  SELECT * INTO v_asset
  FROM public.assets
  WHERE id = v_req.asset_id
  FOR UPDATE;

  IF p_action = 'approve' THEN
    IF v_req.status <> 'pending' THEN
      RAISE EXCEPTION 'สามารถอนุมัติได้เฉพาะคำขอที่อยู่ในสถานะรออนุมัติเท่านั้น';
    END IF;
    IF v_asset.status <> 'available' THEN
      RAISE EXCEPTION 'ครุภัณฑ์นี้ไม่พร้อมให้ยืม (สถานะปัจจุบัน: %)', v_asset.status;
    END IF;

    UPDATE public.borrow_requests
    SET
      status = 'approved',
      approved_by = auth.uid(),
      approved_at = NOW(),
      notes = COALESCE(p_notes, notes),
      updated_at = NOW()
    WHERE id = p_request_id;

    PERFORM public.write_audit_log(
      'BORROW_APPROVED',
      'borrow_requests',
      p_request_id::TEXT,
      format('อนุมัติคำขอยืม %s สำหรับครุภัณฑ์ %s', v_req.request_no, v_asset.asset_code),
      jsonb_build_object('status', 'pending'),
      jsonb_build_object('status', 'approved')
    );

  ELSIF p_action = 'reject' THEN
    IF v_req.status <> 'pending' THEN
      RAISE EXCEPTION 'สามารถปฏิเสธได้เฉพาะคำขอที่อยู่ในสถานะรออนุมัติเท่านั้น';
    END IF;

    UPDATE public.borrow_requests
    SET
      status = 'rejected',
      approved_by = auth.uid(),
      approved_at = NOW(),
      rejection_reason = COALESCE(p_notes, 'ไม่อนุมัติ'),
      updated_at = NOW()
    WHERE id = p_request_id;

    PERFORM public.write_audit_log(
      'BORROW_REJECTED',
      'borrow_requests',
      p_request_id::TEXT,
      format('ปฏิเสธคำขอยืม %s สำหรับครุภัณฑ์ %s', v_req.request_no, v_asset.asset_code),
      jsonb_build_object('status', 'pending'),
      jsonb_build_object('status', 'rejected', 'reason', p_notes)
    );

  ELSIF p_action = 'checkout' THEN
    IF v_req.status NOT IN ('approved', 'pending') THEN
      RAISE EXCEPTION 'คำขอนี้ไม่อยู่ในสถานะที่สามารถส่งมอบครุภัณฑ์ได้';
    END IF;
    IF v_asset.status <> 'available' THEN
      RAISE EXCEPTION 'ครุภัณฑ์นี้ถูกยืมหรือไม่พร้อมใช้งานแล้ว';
    END IF;

    UPDATE public.borrow_requests
    SET
      status = 'borrowed',
      approved_by = COALESCE(approved_by, auth.uid()),
      approved_at = COALESCE(approved_at, NOW()),
      actual_pickup_date = NOW(),
      notes = COALESCE(p_notes, notes),
      updated_at = NOW()
    WHERE id = p_request_id;

    UPDATE public.assets
    SET
      status = 'borrowed',
      updated_by = auth.uid(),
      updated_at = NOW()
    WHERE id = v_req.asset_id;

    INSERT INTO public.borrow_transactions (
      borrow_request_id,
      asset_id,
      action_type,
      action_date,
      handled_by,
      borrower_id,
      asset_condition,
      condition_notes
    ) VALUES (
      p_request_id,
      v_req.asset_id,
      'checkout',
      NOW(),
      auth.uid(),
      v_req.requester_id,
      COALESCE(p_condition, 'normal'),
      p_notes
    );

    PERFORM public.write_audit_log(
      'BORROW_CHECKOUT',
      'borrow_requests',
      p_request_id::TEXT,
      format('ส่งมอบครุภัณฑ์ %s ตามใบยืม %s', v_asset.asset_code, v_req.request_no),
      jsonb_build_object('asset_status', v_asset.status),
      jsonb_build_object('asset_status', 'borrowed')
    );

  ELSIF p_action = 'checkin' THEN
    IF v_req.status NOT IN ('borrowed', 'overdue') THEN
      RAISE EXCEPTION 'สามารถรับคืนได้เฉพาะรายการที่อยู่ระหว่างยืมเท่านั้น';
    END IF;

    v_new_asset_status := CASE
      WHEN p_condition IN ('damaged') THEN 'under_maintenance'
      WHEN p_condition = 'lost' THEN 'lost'
      ELSE 'available'
    END;

    UPDATE public.borrow_requests
    SET
      status = 'returned',
      actual_return_date = NOW(),
      notes = COALESCE(p_notes, notes),
      updated_at = NOW()
    WHERE id = p_request_id;

    UPDATE public.assets
    SET
      status = v_new_asset_status,
      updated_by = auth.uid(),
      updated_at = NOW()
    WHERE id = v_req.asset_id;

    INSERT INTO public.borrow_transactions (
      borrow_request_id,
      asset_id,
      action_type,
      action_date,
      handled_by,
      borrower_id,
      asset_condition,
      condition_notes
    ) VALUES (
      p_request_id,
      v_req.asset_id,
      'checkin',
      NOW(),
      auth.uid(),
      v_req.requester_id,
      COALESCE(p_condition, 'normal'),
      p_notes
    );

    PERFORM public.write_audit_log(
      'BORROW_CHECKIN',
      'borrow_requests',
      p_request_id::TEXT,
      format('รับคืนครุภัณฑ์ %s ตามใบยืม %s (สภาพ: %s)', v_asset.asset_code, v_req.request_no, p_condition),
      jsonb_build_object('asset_status', 'borrowed'),
      jsonb_build_object('asset_status', v_new_asset_status, 'condition', p_condition)
    );
  ELSE
    RAISE EXCEPTION 'คำสั่ง p_action ไม่ถูกต้อง: %', p_action;
  END IF;

  RETURN jsonb_build_object('success', TRUE, 'request_id', p_request_id, 'action', p_action);
END;
$$;

-- 4. RPC: อนุมัติหรือดำเนินการแทงจำหน่ายครุภัณฑ์ (โดยไม่ลบข้อมูลทะเบียนครุภัณฑ์เดิม)
CREATE OR REPLACE FUNCTION public.process_disposal_workflow(
  p_disposal_id UUID,
  p_new_status TEXT, -- 'submitted', 'under_review', 'approved', 'rejected', 'disposed'
  p_document_no TEXT DEFAULT NULL,
  p_disposal_method TEXT DEFAULT NULL,
  p_salvage_value NUMERIC DEFAULT 0,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_disp RECORD;
  v_asset RECORD;
BEGIN
  IF NOT public.is_staff_or_admin() THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์ดำเนินการคำขอแทงจำหน่าย';
  END IF;

  IF p_new_status IN ('approved', 'rejected', 'disposed') AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'เฉพาะผู้ดูแลระบบหรือผู้มีอำนาจอนุมัติ (Admin) เท่านั้นที่สามารถอนุมัติหรือยืนยันการจำหน่ายขั้นสุดท้ายได้';
  END IF;

  SELECT * INTO v_disp
  FROM public.disposal_requests
  WHERE id = p_disposal_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ไม่พบคำขอจำหน่ายที่ระบุ';
  END IF;

  SELECT * INTO v_asset
  FROM public.assets
  WHERE id = v_disp.asset_id
  FOR UPDATE;

  UPDATE public.disposal_requests
  SET
    status = p_new_status,
    reviewed_by = CASE WHEN p_new_status = 'under_review' THEN auth.uid() ELSE reviewed_by END,
    approved_by = CASE WHEN p_new_status IN ('approved', 'rejected', 'disposed') THEN auth.uid() ELSE approved_by END,
    approved_at = CASE WHEN p_new_status IN ('approved', 'rejected', 'disposed') THEN NOW() ELSE approved_at END,
    document_no = COALESCE(p_document_no, document_no),
    disposal_method = COALESCE(p_disposal_method, disposal_method),
    salvage_value = COALESCE(p_salvage_value, salvage_value),
    disposal_date = CASE WHEN p_new_status = 'disposed' THEN CURRENT_DATE ELSE disposal_date END,
    notes = COALESCE(p_notes, notes),
    updated_at = NOW()
  WHERE id = p_disposal_id;

  IF p_new_status IN ('submitted', 'under_review', 'approved') THEN
    UPDATE public.assets
    SET status = 'pending_disposal', updated_by = auth.uid(), updated_at = NOW()
    WHERE id = v_disp.asset_id AND status <> 'disposed';
  ELSIF p_new_status = 'disposed' THEN
    UPDATE public.assets
    SET status = 'disposed', updated_by = auth.uid(), updated_at = NOW()
    WHERE id = v_disp.asset_id;
  ELSIF p_new_status = 'rejected' THEN
    UPDATE public.assets
    SET status = 'available', updated_by = auth.uid(), updated_at = NOW()
    WHERE id = v_disp.asset_id AND status = 'pending_disposal';
  END IF;

  PERFORM public.write_audit_log(
    'DISPOSAL_' || UPPER(p_new_status),
    'disposal_requests',
    p_disposal_id::TEXT,
    format('ปรับสถานะคำขอจำหน่าย %s ของครุภัณฑ์ %s เป็น %s', v_disp.disposal_no, v_asset.asset_code, p_new_status),
    jsonb_build_object('status', v_disp.status),
    jsonb_build_object('status', p_new_status, 'document_no', p_document_no)
  );

  RETURN jsonb_build_object('success', TRUE, 'disposal_id', p_disposal_id, 'status', p_new_status);
END;
$$;

-- 5. RPC: เปลี่ยนบทบาทและหน่วยงานของผู้ใช้โดย Admin เท่านั้น พร้อมบันทึก Audit Log
CREATE OR REPLACE FUNCTION public.admin_update_user_role(
  p_target_user_id UUID,
  p_new_role TEXT,
  p_department_id UUID DEFAULT NULL,
  p_position TEXT DEFAULT NULL,
  p_is_active BOOLEAN DEFAULT TRUE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old RECORD;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'เฉพาะผู้ดูแลระบบ (Admin) เท่านั้นที่มีสิทธิ์เปลี่ยนบทบาทผู้ใช้';
  END IF;

  IF p_new_role NOT IN ('admin', 'asset_officer', 'requester') THEN
    RAISE EXCEPTION 'บทบาทไม่ถูกต้อง: %', p_new_role;
  END IF;

  SELECT * INTO v_old FROM public.profiles WHERE id = p_target_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ไม่พบโปรไฟล์ผู้ใช้ที่ระบุ';
  END IF;

  UPDATE public.profiles
  SET
    role = p_new_role,
    department_id = COALESCE(p_department_id, department_id),
    position = COALESCE(p_position, position),
    is_active = p_is_active,
    updated_at = NOW()
  WHERE id = p_target_user_id;

  PERFORM public.write_audit_log(
    'USER_ROLE_UPDATED',
    'profiles',
    p_target_user_id::TEXT,
    format('ปรับสิทธิ์ผู้ใช้ %s จาก %s เป็น %s', v_old.email, v_old.role, p_new_role),
    jsonb_build_object('role', v_old.role, 'is_active', v_old.is_active),
    jsonb_build_object('role', p_new_role, 'is_active', p_is_active)
  );

  RETURN jsonb_build_object('success', TRUE, 'user_id', p_target_user_id, 'role', p_new_role);
END;
$$;


-- >>> START OF supabase/migrations/00004_storage_buckets.sql <<<
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


-- >>> START OF supabase/seed.sql <<<
-- =============================================================================
-- ข้อมูลตัวอย่างสำหรับการพัฒนาและทดสอบ (Development Seed Data)
-- คำเตือน: ใช้สำหรับสภาพแวดล้อมการพัฒนา (Development / Staging) เท่านั้น
-- ห้ามรันไฟล์นี้ทับฐานข้อมูล Production ที่มีข้อมูลจริงของหน่วยงาน
-- =============================================================================

-- 1. ตั้งค่าระบบเริ่มต้น
INSERT INTO public.system_settings (
  id, org_name, org_short_name, org_address, org_phone, org_email,
  asset_code_prefix, asset_code_format, current_fiscal_year, borrow_reminder_days
) VALUES (
  '00000000-0000-0000-0000-000000000001',
  'กรมส่งเสริมการบริหารงานพัสดุและเทคโนโลยีสารสนเทศ',
  'กพท.',
  '120 หมู่ 3 อาคารรัฐประศาสนภักดี ถนนแจ้งวัฒนะ เขตหลักสี่ กรุงเทพมหานคร 10210',
  '02-141-0000',
  'asset-admin@agency.go.th',
  'กพท',
  '{PREFIX}-{CATEGORY}-{YEAR}-{SEQ4}',
  2569,
  3
) ON CONFLICT (id) DO NOTHING;

-- 2. หน่วยงาน/กอง/กลุ่มงาน
INSERT INTO public.departments (id, code, name, phone, is_active) VALUES
  ('11111111-1111-1111-1111-111111111101', 'FAD', 'กองคลังและพัสดุกลาง', '02-141-1101', TRUE),
  ('11111111-1111-1111-1111-111111111102', 'ITD', 'ศูนย์เทคโนโลยีสารสนเทศและการสื่อสาร', '02-141-1102', TRUE),
  ('11111111-1111-1111-1111-111111111103', 'GAD', 'สำนักงานเลขานุการกรม', '02-141-1103', TRUE),
  ('11111111-1111-1111-1111-111111111104', 'PLD', 'กองแผนงานและวิชาการ', '02-141-1104', TRUE)
ON CONFLICT (code) DO NOTHING;

-- 3. อาคารและสถานที่ตั้ง
INSERT INTO public.locations (id, department_id, code, building, floor, room, name, description) VALUES
  ('22222222-2222-2222-2222-222222222201', '11111111-1111-1111-1111-111111111101', 'BLD-A-201', 'อาคารอำนวยการ A', '2', '201', 'ห้องกลุ่มงานบริหารพัสดุ', 'คลังพัสดุและสำนักงานเจ้าหน้าที่พัสดุ'),
  ('22222222-2222-2222-2222-222222222202', '11111111-1111-1111-1111-111111111102', 'BLD-A-405', 'อาคารอำนวยการ A', '4', '405', 'ศูนย์ปฏิบัติการระบบเครือข่าย (NOC)', 'ห้องเซิร์ฟเวอร์และอุปกรณ์ไอที'),
  ('22222222-2222-2222-2222-222222222203', '11111111-1111-1111-1111-111111111103', 'BLD-B-102', 'อาคารบริการประชาชน B', '1', '102', 'ห้องประชุมใหญ่ ชั้น 1', 'ห้องประชุมความจุ 80 ที่นั่ง'),
  ('22222222-2222-2222-2222-222222222204', '11111111-1111-1111-1111-111111111104', 'BLD-A-302', 'อาคารอำนวยการ A', '3', '302', 'ห้องปฏิบัติการวิเคราะห์แผนงาน', 'สำนักงานกองแผนงาน')
ON CONFLICT (code) DO NOTHING;

-- 4. หมวดหมู่ครุภัณฑ์
INSERT INTO public.asset_categories (id, code, name, useful_life_years, depreciation_rate, description) VALUES
  ('33333333-3333-3333-3333-333333333301', '7440', 'ครุภัณฑ์คอมพิวเตอร์และอุปกรณ์ต่อพ่วง', 5, 20.00, 'เครื่องคอมพิวเตอร์ โน้ตบุ๊ก เครื่องพิมพ์ เครื่องสแกน และอุปกรณ์เครือข่าย'),
  ('33333333-3333-3333-3333-333333333302', '7110', 'ครุภัณฑ์สำนักงาน', 5, 20.00, 'โต๊ะทำงาน เก้าอี้สำนักงาน ตู้เก็บเอกสาร เครื่องทำลายเอกสาร เครื่องปรับอากาศ'),
  ('33333333-3333-3333-3333-333333333303', '7730', 'ครุภัณฑ์โฆษณาและเผยแพร่', 5, 20.00, 'เครื่องฉายภาพโปรเจคเตอร์ กล้องถ่ายภาพ ชุดเครื่องเสียงห้องประชุม จอแสดงผลอัจฉริยะ'),
  ('33333333-3333-3333-3333-333333333304', '6515', 'ครุภัณฑ์ไฟฟ้าและวิทยุ', 5, 20.00, 'เครื่องสำรองไฟขนาดใหญ่ อุปกรณ์สื่อสารวิทยุ และระบบจ่ายไฟสำรอง')
ON CONFLICT (code) DO NOTHING;

-- 5. รายการครุภัณฑ์ตัวอย่าง
INSERT INTO public.assets (
  id, asset_code, name, category_id, brand, model, serial_number,
  description, unit_price, acquired_date, contract_number, useful_life_years,
  status, department_id, location_id, notes
) VALUES
  (
    '44444444-4444-4444-4444-444444444401',
    'กพท-7440-2568-0001',
    'เครื่องคอมพิวเตอร์โน้ตบุ๊ก สำหรับงานประมวลผล',
    '33333333-3333-3333-3333-333333333301',
    'Dell',
    'Latitude 5440',
    'DL5440-TH-88901',
    'Intel Core i7, RAM 16GB, SSD 512GB พร้อมระบบปฏิบัติการลิขสิทธิ์',
    34500.00,
    '2025-10-15',
    'สญ.014/2568',
    5,
    'available',
    '11111111-1111-1111-1111-111111111102',
    '22222222-2222-2222-2222-222222222202',
    'ครุภัณฑ์ส่วนกลางสำหรับยืมปฏิบัติราชการนอกสถานที่'
  ),
  (
    '44444444-4444-4444-4444-444444444402',
    'กพท-7440-2568-0002',
    'เครื่องคอมพิวเตอร์ All-in-One สำหรับงานสำนักงาน',
    '33333333-3333-3333-3333-333333333301',
    'HP',
    'ProOne 440 G9',
    'HP440G9-99210',
    'หน้าจอ 23.8 นิ้ว Core i5 RAM 16GB SSD 512GB',
    28900.00,
    '2025-11-02',
    'สญ.018/2568',
    5,
    'available',
    '11111111-1111-1111-1111-111111111101',
    '22222222-2222-2222-2222-222222222201',
    'ใช้งานประจำโต๊ะเจ้าหน้าที่ทะเบียนพัสดุ'
  ),
  (
    '44444444-4444-4444-4444-444444444403',
    'กพท-7730-2567-0015',
    'เครื่องฉายภาพโปรเจคเตอร์เลเซอร์ความสว่างสูง',
    '33333333-3333-3333-3333-333333333303',
    'Epson',
    'EB-L530U',
    'EPS-L530-44120',
    'ความสว่าง 5,200 Lumens ความละเอียด WUXGA รองรับการเชื่อมต่อไร้สาย',
    68000.00,
    '2024-06-20',
    'สญ.042/2567',
    5,
    'available',
    '11111111-1111-1111-1111-111111111103',
    '22222222-2222-2222-2222-222222222203',
    'ติดตั้งประจำห้องประชุมใหญ่ ชั้น 1'
  ),
  (
    '44444444-4444-4444-4444-444444444404',
    'กพท-7110-2566-0008',
    'เครื่องทำลายเอกสารชนิดตัดละเอียดระดับความลับสูง',
    '33333333-3333-3333-3333-333333333302',
    'Fellowes',
    'AutoMax 200C',
    'FLW-200C-30112',
    'ทำลายเอกสารต่อเนื่องอัตโนมัติ 200 แผ่น ถังจุ 32 ลิตร',
    19500.00,
    '2023-08-10',
    'บส.091/2566',
    5,
    'under_maintenance',
    '11111111-1111-1111-1111-111111111103',
    '22222222-2222-2222-2222-222222222203',
    'ส่งตรวจเช็กใบมีดและมอเตอร์ตามรอบบำรุงรักษา'
  ),
  (
    '44444444-4444-4444-4444-444444444405',
    'กพท-7440-2568-0009',
    'เครื่องสแกนเอกสารความเร็วสูงแบบป้อนกระดาษอัตโนมัติ',
    '33333333-3333-3333-3333-333333333301',
    'Fujitsu',
    'fi-8170',
    'FUJ-8170-77541',
    'สแกนสองหน้าอัตโนมัติ 70 แผ่นต่อนาที รองรับงานสารบรรณอิเล็กทรอนิกส์',
    32000.00,
    '2025-12-01',
    'สญ.025/2568',
    5,
    'available',
    '11111111-1111-1111-1111-111111111104',
    '22222222-2222-2222-2222-222222222204',
    'ใช้งานประจำกองแผนงานและวิชาการ'
  )
ON CONFLICT (asset_code) DO NOTHING;

-- 6. รอบตรวจนับครุภัณฑ์ประจำปีตัวอย่าง
INSERT INTO public.inventory_sessions (
  id, session_code, name, fiscal_year, start_date, end_date,
  department_id, status, notes
) VALUES (
  '55555555-5555-5555-5555-555555555501',
  'INV-2569-01',
  'การตรวจสอบพัสดุประจำปีงบประมาณ พ.ศ. 2569 (รอบประจำปี)',
  2569,
  '2026-10-01',
  '2026-11-30',
  NULL,
  'in_progress',
  'แต่งตั้งคณะกรรมการตรวจสอบพัสดุประจำปีตามระเบียบกระทรวงการคลังฯ'
) ON CONFLICT (session_code) DO NOTHING;

-- 7. กิจกรรมปฏิทินองค์กรตัวอย่าง
INSERT INTO public.corporate_events (
  id, title, description, category, start_at, end_at, all_day, location, participants, notes
) VALUES
  (
    '66666666-6666-6666-6666-666666666601',
    'ประชุมคณะกรรมการตรวจนับครุภัณฑ์ประจำปี 2569',
    'ชี้แจงแนวทางการสแกน QR Code ครุภัณฑ์และการบันทึกผลตรวจนับผ่านระบบดิจิทัล',
    'inventory',
    '2026-10-25T09:30:00+07:00',
    '2026-10-25T12:00:00+07:00',
    FALSE,
    'ห้องประชุมใหญ่ ชั้น 1 อาคารบริการประชาชน B',
    'คณะกรรมการตรวจนับพัสดุทุกกอง/สำนัก',
    'เตรียมอุปกรณ์แท็บเล็ตหรือสมาร์ตโฟนสำหรับทดสอบสแกน'
  ),
  (
    '66666666-6666-6666-6666-666666666602',
    'บำรุงรักษาเครื่องปรับอากาศและระบบไฟฟ้าสำรองประจำไตรมาส',
    'การตรวจเช็กสภาพครุภัณฑ์ไฟฟ้าและเครื่องสำรองไฟห้องเซิร์ฟเวอร์',
    'maintenance',
    '2026-10-28T13:00:00+07:00',
    '2026-10-28T16:30:00+07:00',
    FALSE,
    'ศูนย์ปฏิบัติการระบบเครือข่าย (NOC) ชั้น 4',
    'เจ้าหน้าที่ศูนย์เทคโนโลยีสารสนเทศ และบริษัทผู้รับจ้าง',
    'ไม่กระทบการใช้งานเครือข่ายหลัก'
  ),
  (
    '66666666-6666-6666-6666-666666666603',
    'อบรมการใช้งานระบบบริหารจัดการครุภัณฑ์สำนักงานสำหรับบุคลากรใหม่',
    'แนะนำการขอยืมครุภัณฑ์ การแจ้งซ่อมออนไลน์ และการตรวจสอบครุภัณฑ์ในความรับผิดชอบ',
    'training',
    '2026-11-05T09:00:00+07:00',
    '2026-11-05T12:00:00+07:00',
    FALSE,
    'ห้องปฏิบัติการคอมพิวเตอร์ ชั้น 4',
    'ข้าราชการและเจ้าหน้าที่บรรจุใหม่',
    'มีคู่มืออิเล็กทรอนิกส์แจกในระบบ'
  )
ON CONFLICT (id) DO NOTHING;



