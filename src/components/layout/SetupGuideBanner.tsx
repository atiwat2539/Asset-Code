import React, { useState } from 'react';
import { isSupabaseConfigured, supabaseConfigStatus } from '@/lib/supabase';
import { AlertTriangle, CheckCircle2, Database, FileCode, KeyRound, ShieldCheck, Terminal } from 'lucide-react';
import { Modal } from '../ui/common';

export function SetupGuideBanner() {
  const [openGuide, setOpenGuide] = useState(false);

  if (isSupabaseConfigured()) {
    return null;
  }

  return (
    <>
      <div className="border-b border-amber-300 bg-amber-50 px-4 py-3 text-amber-950 shadow-xs">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <div className="text-xs sm:text-sm">
              <span className="font-bold">สถานะระบบ: ยังไม่ได้ตั้งค่าการเชื่อมต่อฐานข้อมูล Supabase จริง</span>{' '}
              — กรุณาสร้างไฟล์ <code className="rounded bg-amber-200/70 px-1.5 py-0.5 font-mono text-xs">.env.local</code> และรัน SQL Migration เพื่อเปิดใช้งานการบันทึกข้อมูลจริง
            </div>
          </div>
          <button
            type="button"
            onClick={() => setOpenGuide(true)}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-800"
          >
            <Database className="h-3.5 w-3.5" />
            ดูคู่มือตั้งค่า Supabase ทีละขั้นตอน
          </button>
        </div>
      </div>

      <SetupGuideModal open={openGuide} onClose={() => setOpenGuide(false)} />
    </>
  );
}

export function SetupGuideModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="คู่มือการตั้งค่าฐานข้อมูล Supabase สำหรับผู้เริ่มต้น"
      description="ทำตามขั้นตอนด้านล่างเพื่อเชื่อมต่อแอปพลิเคชันเข้ากับฐานข้อมูลจริงของหน่วยงาน"
      maxWidth="max-w-3xl"
    >
      <div className="space-y-5 text-sm text-slate-700">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <h3 className="font-semibold text-slate-900 flex items-center gap-2">
            <Database className="h-4 w-4 text-gov-700" />
            สถานะการเชื่อมต่อปัจจุบัน (Environment Status)
          </h3>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 text-xs">
            <div className="flex items-center justify-between rounded-lg bg-white p-2.5 border border-slate-200">
              <span>VITE_SUPABASE_URL:</span>
              {supabaseConfigStatus.url ? (
                <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
                  <CheckCircle2 className="h-4 w-4" /> ตั้งค่าแล้ว
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 font-medium text-rose-600">
                  <AlertTriangle className="h-4 w-4" /> ยังไม่ได้ตั้งค่า
                </span>
              )}
            </div>
            <div className="flex items-center justify-between rounded-lg bg-white p-2.5 border border-slate-200">
              <span>VITE_SUPABASE_ANON_KEY:</span>
              {supabaseConfigStatus.hasKey ? (
                <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
                  <CheckCircle2 className="h-4 w-4" /> ตั้งค่าแล้ว
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 font-medium text-rose-600">
                  <AlertTriangle className="h-4 w-4" /> ยังไม่ได้ตั้งค่า
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex gap-3">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gov-700 text-xs font-bold text-white">
              1
            </div>
            <div className="flex-1">
              <h4 className="font-semibold text-slate-900 flex items-center gap-1.5">
                <KeyRound className="h-4 w-4 text-gov-700" />
                คัดลอก Project URL และ Anon Key จาก Supabase
              </h4>
              <p className="mt-1 text-xs text-slate-600">
                สร้างโปรเจกต์ที่ <a href="https://supabase.com" target="_blank" rel="noreferrer" className="text-gov-700 underline">supabase.com</a> จากนั้นไปที่เมนู <strong>Project Settings &gt; API</strong> แล้วสร้างไฟล์ <code className="rounded bg-slate-100 px-1 py-0.5 font-mono">.env.local</code> ในโฟลเดอร์โปรเจกต์:
              </p>
              <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100 font-mono">
{`VITE_SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY`}
              </pre>
              <p className="mt-1 text-xs text-rose-600 font-medium">
                * ห้ามนำ service_role key (Secret) มาใส่ในไฟล์ .env.local เด็ดขาด
              </p>
            </div>
          </div>

          <div className="flex gap-3">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gov-700 text-xs font-bold text-white">
              2
            </div>
            <div className="flex-1">
              <h4 className="font-semibold text-slate-900 flex items-center gap-1.5">
                <FileCode className="h-4 w-4 text-gov-700" />
                รันไฟล์ SQL Migration ใน Supabase SQL Editor ตามลำดับ
              </h4>
              <p className="mt-1 text-xs text-slate-600">
                เปิดเมนู <strong>SQL Editor</strong> ใน Supabase Dashboard แล้วคัดลอกโค้ดในโฟลเดอร์ <code className="rounded bg-slate-100 px-1 py-0.5 font-mono">supabase/migrations/</code> ไปรันตามลำดับดังนี้:
              </p>
              <ol className="mt-1.5 list-decimal list-inside space-y-1 text-xs text-slate-700 font-mono bg-slate-50 p-3 rounded-lg border border-slate-200">
                <li>supabase/migrations/00001_initial_schema.sql (สร้าง 18 ตารางหลัก + Triggers)</li>
                <li>supabase/migrations/00002_rls_policies.sql (เปิด RLS และสร้างนโยบายสิทธิ์)</li>
                <li>supabase/migrations/00003_rpc_functions.sql (สร้าง Transaction Functions & Audit Log)</li>
                <li>supabase/migrations/00004_storage_buckets.sql (สร้าง Storage Buckets ทั้ง 4 รายการ)</li>
                <li>supabase/seed.sql (ทางเลือก: ข้อมูลตัวอย่างสำหรับทดสอบระบบ)</li>
              </ol>
            </div>
          </div>

          <div className="flex gap-3">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gov-700 text-xs font-bold text-white">
              3
            </div>
            <div className="flex-1">
              <h4 className="font-semibold text-slate-900 flex items-center gap-1.5">
                <ShieldCheck className="h-4 w-4 text-gov-700" />
                สร้างผู้ดูแลระบบ (Admin) คนแรกอย่างปลอดภัย
              </h4>
              <p className="mt-1 text-xs text-slate-600">
                สร้างผู้ใช้ผ่านเมนู <strong>Authentication &gt; Users &gt; Add User</strong> ใน Supabase จากนั้นรันคำสั่ง SQL ด้านล่างใน SQL Editor เพื่อยกระดับเป็น <code className="rounded bg-slate-100 px-1 py-0.5 font-mono">admin</code>:
              </p>
              <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100 font-mono">
{`UPDATE public.profiles
SET role = 'admin',
    full_name = 'ผู้ดูแลระบบพัสดุกลาง',
    position = 'นักวิชาการพัสดุชำนาญการ'
WHERE email = 'admin@agency.go.th';`}
              </pre>
            </div>
          </div>

          <div className="flex gap-3">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gov-700 text-xs font-bold text-white">
              4
            </div>
            <div className="flex-1">
              <h4 className="font-semibold text-slate-900 flex items-center gap-1.5">
                <Terminal className="h-4 w-4 text-gov-700" />
                รีสตาร์ทเซิร์ฟเวอร์พัฒนา
              </h4>
              <p className="mt-1 text-xs text-slate-600">
                หลังบันทึกไฟล์ <code className="rounded bg-slate-100 px-1 py-0.5 font-mono">.env.local</code> ให้หยุดและรัน <code className="rounded bg-slate-100 px-1 py-0.5 font-mono">npm run dev</code> ใหม่อีกครั้ง
              </p>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
