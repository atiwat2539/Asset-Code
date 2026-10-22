-- =============================================================================
-- สคริปต์สร้างหรือรีเซ็ตบัญชีผู้ดูแลระบบ (Admin) อัตโนมัติสำหรับ Supabase SQL Editor
-- อีเมลเริ่มต้น: admin@agency.go.th
-- รหัสผ่านเริ่มต้น: Admin@123456
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$
DECLARE
  v_email TEXT := 'admin@agency.go.th';
  v_password TEXT := 'Admin@123456';
  v_user_id UUID;
BEGIN
  -- ค้นหาว่ามีผู้ใช้นี้ใน auth.users แล้วหรือไม่
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE email = v_email
  LIMIT 1;

  IF v_user_id IS NULL THEN
    -- กรณีที่ยังไม่มีผู้ใช้ใน auth.users ให้สร้างใหม่พร้อมยืนยันอีเมลทันที
    v_user_id := gen_random_uuid();

    INSERT INTO auth.users (
      instance_id,
      id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at,
      confirmation_token,
      email_change,
      email_change_token_new,
      recovery_token
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      v_user_id,
      'authenticated',
      'authenticated',
      v_email,
      extensions.crypt(v_password, extensions.gen_salt('bf')),
      NOW(),
      '{"provider": "email", "providers": ["email"]}'::jsonb,
      jsonb_build_object(
        'sub', v_user_id::text,
        'email', v_email,
        'full_name', 'ผู้ดูแลระบบพัสดุกลาง',
        'email_verified', true,
        'phone_verified', false
      ),
      NOW(),
      NOW(),
      '',
      '',
      '',
      ''
    );
  ELSE
    -- กรณีที่มีผู้ใช้อยู่แล้ว ให้รีเซ็ตรหัสผ่านและยืนยันอีเมลให้พร้อมใช้งานทันที
    UPDATE auth.users
    SET encrypted_password = extensions.crypt(v_password, extensions.gen_salt('bf')),
        email_confirmed_at = COALESCE(email_confirmed_at, NOW()),
        raw_app_meta_data = '{"provider": "email", "providers": ["email"]}'::jsonb,
        confirmation_token = COALESCE(confirmation_token, ''),
        email_change = COALESCE(email_change, ''),
        email_change_token_new = COALESCE(email_change_token_new, ''),
        recovery_token = COALESCE(recovery_token, ''),
        updated_at = NOW()
    WHERE id = v_user_id;
  END IF;

  -- ตรวจสอบและสร้างข้อมูลใน auth.identities
  IF NOT EXISTS (
    SELECT 1 FROM auth.identities WHERE user_id = v_user_id AND provider = 'email'
  ) THEN
    INSERT INTO auth.identities (
      id,
      user_id,
      provider_id,
      identity_data,
      provider,
      last_sign_in_at,
      created_at,
      updated_at
    ) VALUES (
      gen_random_uuid(),
      v_user_id,
      v_user_id::text,
      jsonb_build_object(
        'sub', v_user_id::text,
        'email', v_email,
        'email_verified', true,
        'phone_verified', false
      ),
      'email',
      NOW(),
      NOW(),
      NOW()
    );
  END IF;

  -- สร้างหรืออัปเดตโปรไฟล์ใน public.profiles ให้เป็นระดับ admin
  INSERT INTO public.profiles (id, email, full_name, role, position, is_active)
  VALUES (
    v_user_id,
    v_email,
    'ผู้ดูแลระบบพัสดุกลาง',
    'admin',
    'นักวิชาการพัสดุชำนาญการ',
    TRUE
  )
  ON CONFLICT (id) DO UPDATE
  SET email = EXCLUDED.email,
      full_name = EXCLUDED.full_name,
      role = 'admin',
      position = EXCLUDED.position,
      is_active = TRUE,
      updated_at = NOW();
END $$;

-- ตรวจสอบผลลัพธ์หลังรัน
SELECT id, email, role, full_name, is_active FROM public.profiles WHERE email = 'admin@agency.go.th';
