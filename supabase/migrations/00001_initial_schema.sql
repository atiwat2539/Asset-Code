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
