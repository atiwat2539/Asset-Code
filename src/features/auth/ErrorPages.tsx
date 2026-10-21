import React from 'react';
import { Link } from 'react-router-dom';
import { ShieldAlert, FileQuestion, ArrowLeft } from 'lucide-react';
import { useAuth } from './AuthContext';
import { ROLE_LABELS } from '@/lib/utils';

export function AccessDeniedPage() {
  const { role, profile } = useAuth();

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center p-6 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-rose-100 text-rose-700">
        <ShieldAlert className="h-8 w-8" />
      </div>
      <h1 className="mt-5 text-2xl font-bold text-slate-900">
        ไม่มีสิทธิ์เข้าถึงหน้านี้ (Access Denied)
      </h1>
      <p className="mt-2 max-w-md text-sm text-slate-600">
        บัญชีของคุณ ({profile?.email || 'ผู้ใช้งานปัจจุบัน'}) มีระดับสิทธิ์เป็น{' '}
        <strong>{ROLE_LABELS[role]?.label || role}</strong> ซึ่งไม่ได้รับอนุญาตให้เข้าถึงเมนูหรือการดำเนินการนี้
      </p>
      <div className="mt-6 flex items-center gap-3">
        <Link
          to="/"
          className="inline-flex items-center gap-2 rounded-lg bg-gov-700 px-4 py-2 text-sm font-medium text-white hover:bg-gov-800"
        >
          <ArrowLeft className="h-4 w-4" />
          กลับสู่หน้าหลัก (Dashboard)
        </Link>
      </div>
    </div>
  );
}

export function NotFoundPage() {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center p-6 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-200 text-slate-700">
        <FileQuestion className="h-8 w-8" />
      </div>
      <h1 className="mt-5 text-2xl font-bold text-slate-900">
        404 — ไม่พบหน้าที่คุณต้องการ (Page Not Found)
      </h1>
      <p className="mt-2 max-w-md text-sm text-slate-600">
        ลิงก์ที่คุณเปิดอาจถูกย้าย เปลี่ยนแปลง หรือไม่มีอยู่ในระบบบริหารจัดการครุภัณฑ์สำนักงาน
      </p>
      <div className="mt-6">
        <Link
          to="/"
          className="inline-flex items-center gap-2 rounded-lg bg-gov-700 px-4 py-2 text-sm font-medium text-white hover:bg-gov-800"
        >
          <ArrowLeft className="h-4 w-4" />
          กลับสู่หน้าหลัก
        </Link>
      </div>
    </div>
  );
}
