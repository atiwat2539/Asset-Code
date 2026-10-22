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
  ELSIF p_new_status IN ('rejected', 'draft') THEN
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

-- 5. RPC: แก้ไขข้อมูล บทบาท และหน่วยงานของผู้ใช้โดย Admin เท่านั้น พร้อมบันทึก Audit Log
CREATE OR REPLACE FUNCTION public.admin_update_user_role(
  p_target_user_id UUID,
  p_new_role TEXT,
  p_department_id UUID DEFAULT NULL,
  p_position TEXT DEFAULT NULL,
  p_is_active BOOLEAN DEFAULT TRUE,
  p_full_name TEXT DEFAULT NULL,
  p_phone TEXT DEFAULT NULL
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
    RAISE EXCEPTION 'เฉพาะผู้ดูแลระบบ (Admin) เท่านั้นที่มีสิทธิ์แก้ไขข้อมูลและบทบาทผู้ใช้';
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
    full_name = COALESCE(NULLIF(TRIM(p_full_name), ''), full_name),
    role = p_new_role,
    department_id = p_department_id,
    position = p_position,
    phone = COALESCE(p_phone, phone),
    is_active = p_is_active,
    updated_at = NOW()
  WHERE id = p_target_user_id;

  PERFORM public.write_audit_log(
    'USER_ROLE_UPDATED',
    'profiles',
    p_target_user_id::TEXT,
    format('แก้ไขข้อมูล/สิทธิ์ผู้ใช้ %s (สิทธิ์: %s -> %s)', v_old.email, v_old.role, p_new_role),
    jsonb_build_object(
      'full_name', v_old.full_name,
      'role', v_old.role,
      'department_id', v_old.department_id,
      'position', v_old.position,
      'is_active', v_old.is_active
    ),
    jsonb_build_object(
      'full_name', COALESCE(NULLIF(TRIM(p_full_name), ''), v_old.full_name),
      'role', p_new_role,
      'department_id', p_department_id,
      'position', p_position,
      'is_active', p_is_active
    )
  );

  RETURN jsonb_build_object('success', TRUE, 'user_id', p_target_user_id, 'role', p_new_role);
END;
$$;

-- 6. RPC: ลบบัญชีผู้ใช้งานโดย Admin พร้อมบันทึก Audit Log
CREATE OR REPLACE FUNCTION public.admin_delete_user(
  p_target_user_id UUID
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
    RAISE EXCEPTION 'เฉพาะผู้ดูแลระบบ (Admin) เท่านั้นที่มีสิทธิ์ลบบัญชีผู้ใช้งาน';
  END IF;

  IF p_target_user_id = auth.uid() THEN
    RAISE EXCEPTION 'ไม่สามารถลบบัญชีของตนเองที่กำลังเข้าสู่ระบบอยู่ได้';
  END IF;

  SELECT * INTO v_old FROM public.profiles WHERE id = p_target_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ไม่พบโปรไฟล์ผู้ใช้งานที่ต้องการลบ';
  END IF;

  PERFORM public.write_audit_log(
    'USER_DELETED',
    'profiles',
    p_target_user_id::TEXT,
    format('ลบบัญชีผู้ใช้งาน %s (%s) ออกจากระบบ', v_old.full_name, v_old.email),
    jsonb_build_object(
      'email', v_old.email,
      'full_name', v_old.full_name,
      'role', v_old.role,
      'department_id', v_old.department_id
    ),
    NULL
  );

  DELETE FROM public.profiles WHERE id = p_target_user_id;
  DELETE FROM auth.users WHERE id = p_target_user_id;

  RETURN jsonb_build_object('success', TRUE, 'deleted_user_id', p_target_user_id);
END;
$$;

-- 7. RPC: ลบครุภัณฑ์พร้อมประวัติธุรกรรมที่เกี่ยวข้องโดย Admin หรือเจ้าหน้าที่พัสดุ
CREATE OR REPLACE FUNCTION public.delete_asset_cascade(
  p_asset_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_asset RECORD;
BEGIN
  IF NOT public.is_staff_or_admin() THEN
    RAISE EXCEPTION 'เฉพาะผู้ดูแลระบบหรือเจ้าหน้าที่พัสดุเท่านั้นที่มีสิทธิ์ลบรายการครุภัณฑ์';
  END IF;

  SELECT * INTO v_asset FROM public.assets WHERE id = p_asset_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ไม่พบข้อมูลครุภัณฑ์ที่ต้องการลบ';
  END IF;

  PERFORM public.write_audit_log(
    'ASSET_DELETED',
    'assets',
    p_asset_id::TEXT,
    format('ลบครุภัณฑ์ %s (%s) ออกจากระบบ', v_asset.asset_code, v_asset.name),
    jsonb_build_object(
      'asset_code', v_asset.asset_code,
      'name', v_asset.name,
      'unit_price', v_asset.unit_price,
      'status', v_asset.status
    ),
    NULL
  );

  DELETE FROM public.borrow_transactions WHERE asset_id = p_asset_id;
  DELETE FROM public.borrow_requests WHERE asset_id = p_asset_id;
  DELETE FROM public.maintenance_logs WHERE asset_id = p_asset_id;
  DELETE FROM public.maintenance_requests WHERE asset_id = p_asset_id;
  DELETE FROM public.disposal_requests WHERE asset_id = p_asset_id;
  DELETE FROM public.asset_transfers WHERE asset_id = p_asset_id;
  DELETE FROM public.inventory_items WHERE asset_id = p_asset_id;
  DELETE FROM public.asset_attachments WHERE asset_id = p_asset_id;
  DELETE FROM public.assets WHERE id = p_asset_id;

  RETURN jsonb_build_object('success', TRUE, 'deleted_asset_id', p_asset_id);
END;
$$;

-- 8. RPC: ลบข้อมูลครุภัณฑ์ทั้งระบบพร้อมประวัติธุรกรรมที่เกี่ยวข้อง (เฉพาะ Admin)
CREATE OR REPLACE FUNCTION public.delete_all_assets_system_wide()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER := 0;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'เฉพาะผู้ดูแลระบบ (Admin) เท่านั้นที่มีสิทธิ์ลบข้อมูลครุภัณฑ์ทั้งระบบ';
  END IF;

  SELECT COUNT(*)::INTEGER INTO v_count FROM public.assets;

  DELETE FROM public.borrow_transactions WHERE TRUE;
  DELETE FROM public.borrow_requests WHERE TRUE;
  DELETE FROM public.maintenance_logs WHERE TRUE;
  DELETE FROM public.maintenance_requests WHERE TRUE;
  DELETE FROM public.disposal_requests WHERE TRUE;
  DELETE FROM public.asset_transfers WHERE TRUE;
  DELETE FROM public.inventory_items WHERE TRUE;
  DELETE FROM public.asset_attachments WHERE TRUE;
  DELETE FROM public.assets WHERE TRUE;

  PERFORM public.write_audit_log(
    'ALL_ASSETS_DELETED',
    'assets',
    'ALL',
    format('ลบข้อมูลครุภัณฑ์และประวัติธุรกรรมทั้งระบบ จำนวน %s รายการ', v_count),
    jsonb_build_object('deleted_count', v_count),
    NULL
  );

  RETURN jsonb_build_object('success', TRUE, 'deleted_count', v_count);
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_all_assets_system_wide() TO authenticated;
