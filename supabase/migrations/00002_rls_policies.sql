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

CREATE POLICY "profiles_delete_admin"
  ON public.profiles FOR DELETE
  TO authenticated
  USING (public.is_admin() AND id <> auth.uid());

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
  USING (public.is_staff_or_admin());

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

CREATE POLICY "attachments_update_staff"
  ON public.asset_attachments FOR UPDATE
  TO authenticated
  USING (public.is_staff_or_admin() OR uploaded_by = auth.uid())
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
  USING (public.is_staff_or_admin() OR (requested_by = auth.uid() AND status = 'pending'))
  WITH CHECK (public.is_staff_or_admin() OR (requested_by = auth.uid() AND status IN ('pending', 'cancelled')));

CREATE POLICY "transfers_delete_staff"
  ON public.asset_transfers FOR DELETE
  TO authenticated
  USING (public.is_staff_or_admin() OR (requested_by = auth.uid() AND status = 'pending'));

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

CREATE POLICY "borrow_requests_delete"
  ON public.borrow_requests FOR DELETE
  TO authenticated
  USING (
    public.is_staff_or_admin()
    OR (requester_id = auth.uid() AND status = 'pending')
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

CREATE POLICY "borrow_transactions_delete_staff"
  ON public.borrow_transactions FOR DELETE
  TO authenticated
  USING (public.is_staff_or_admin());

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

CREATE POLICY "maintenance_requests_delete"
  ON public.maintenance_requests FOR DELETE
  TO authenticated
  USING (public.is_staff_or_admin() OR (reported_by = auth.uid() AND status = 'pending'));

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

CREATE POLICY "maintenance_logs_delete_staff"
  ON public.maintenance_logs FOR DELETE
  TO authenticated
  USING (public.is_staff_or_admin());

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

CREATE POLICY "disposal_requests_delete_staff"
  ON public.disposal_requests FOR DELETE
  TO authenticated
  USING (public.is_staff_or_admin());

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
