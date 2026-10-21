import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type {
  AssetStatus,
  BorrowStatus,
  DisposalStatus,
  EventCategory,
  InventoryResultStatus,
  MaintenanceStatus,
  MaintenanceUrgency,
  TransferStatus,
  UserRole,
} from '@/types/database';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number | string | null | undefined): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount ?? 0;
  if (Number.isNaN(num)) return '0.00 บาท';
  return `${new Intl.NumberFormat('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num)} บาท`;
}

export function formatNumber(amount: number | string | null | undefined): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount ?? 0;
  if (Number.isNaN(num)) return '0';
  return new Intl.NumberFormat('th-TH').format(num);
}

/**
 * แปลข้อความ Error จาก Supabase / PostgreSQL ให้เป็นภาษาไทยที่ผู้ใช้เข้าใจง่าย
 * โดยไม่เปิดเผยโครงสร้างภายในฐานข้อมูลหรือข้อมูลลับ
 */
export function translateSupabaseError(error: unknown): string {
  if (!error) return 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ';

  const errObj = error as { code?: string; message?: string; details?: string };
  const msg = (errObj.message || String(error)).toLowerCase();
  const code = errObj.code || '';

  if (code === '23505' || msg.includes('duplicate key') || msg.includes('unique constraint')) {
    if (msg.includes('asset_code')) {
      return 'เลขครุภัณฑ์นี้มีอยู่ในระบบแล้ว กรุณาตรวจสอบและระบุเลขครุภัณฑ์ที่ไม่ซ้ำ';
    }
    if (msg.includes('code')) {
      return 'รหัสข้อมูลนี้ซ้ำกับที่มีอยู่ในระบบ กรุณาใช้รหัสอื่น';
    }
    return 'ข้อมูลซ้ำกับที่มีอยู่ในระบบแล้ว กรุณาตรวจสอบรหัสหรือเลขที่เอกสาร';
  }

  if (code === '23503' || msg.includes('foreign key constraint')) {
    return 'ไม่สามารถลบหรือแก้ไขข้อมูลได้ เนื่องจากมีประวัติธุรกรรมหรือข้อมูลอื่นอ้างอิงอยู่';
  }

  if (code === '42501' || msg.includes('row-level security') || msg.includes('permission denied')) {
    return 'คุณไม่มีสิทธิ์ดำเนินการรายการนี้ตามนโยบายความปลอดภัยของระบบ (RLS Permission Denied)';
  }

  if (msg.includes('invalid login credentials')) {
    return 'อีเมลหรือรหัสผ่านไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง';
  }

  if (msg.includes('email not confirmed')) {
    return 'บัญชีนี้ยังไม่ได้ยืนยันอีเมล กรุณาตรวจสอบกล่องจดหมายของคุณ';
  }

  if (msg.includes('jwt expired') || msg.includes('session_not_found')) {
    return 'เซสชันการใช้งานหมดอายุ กรุณาเข้าสู่ระบบใหม่อีกครั้ง';
  }

  if (msg.includes('failed to fetch') || msg.includes('networkerror')) {
    return 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ฐานข้อมูลได้ กรุณาตรวจสอบอินเทอร์เน็ตหรือการตั้งค่า Supabase URL';
  }

  // หากเป็นข้อความภาษาไทยจาก RAISE EXCEPTION ใน RPC ให้แสดงข้อความนั้นโดยตรง
  if (/[\u0E00-\u0E7F]/.test(errObj.message || '')) {
    return errObj.message!;
  }

  return errObj.message || 'เกิดข้อผิดพลาดในการดำเนินการ กรุณาลองใหม่อีกครั้ง';
}

export const ROLE_LABELS: Record<UserRole, { label: string; badgeClass: string; description: string }> = {
  admin: {
    label: 'ผู้ดูแลระบบ (Admin)',
    badgeClass: 'bg-purple-100 text-purple-800 border-purple-300',
    description: 'จัดการผู้ใช้ ตั้งค่าระบบ อนุมัติขั้นสุดท้าย และเข้าถึงข้อมูลทั้งหมด',
  },
  asset_officer: {
    label: 'เจ้าหน้าที่พัสดุ (Asset Officer)',
    badgeClass: 'bg-blue-100 text-blue-800 border-blue-300',
    description: 'จัดการทะเบียนครุภัณฑ์ ตรวจนับ อนุมัติยืม-คืน โอนย้าย แจ้งซ่อม และออกรายงาน',
  },
  requester: {
    label: 'บุคลากร/ผู้ใช้งานทั่วไป (Requester)',
    badgeClass: 'bg-slate-100 text-slate-800 border-slate-300',
    description: 'ค้นหาครุภัณฑ์ ส่งคำขอยืม แจ้งซ่อม และติดตามสถานะคำขอของตนเอง',
  },
};

export const ASSET_STATUS_META: Record<
  AssetStatus,
  { label: string; badgeClass: string; dotClass: string }
> = {
  available: {
    label: 'พร้อมใช้งาน',
    badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    dotClass: 'bg-emerald-500',
  },
  borrowed: {
    label: 'กำลังถูกยืม',
    badgeClass: 'bg-sky-50 text-sky-800 border-sky-200',
    dotClass: 'bg-sky-500',
  },
  under_maintenance: {
    label: 'อยู่ระหว่างซ่อมบำรุง',
    badgeClass: 'bg-amber-50 text-amber-800 border-amber-200',
    dotClass: 'bg-amber-500',
  },
  pending_disposal: {
    label: 'รอพิจารณาจำหน่าย',
    badgeClass: 'bg-orange-50 text-orange-800 border-orange-200',
    dotClass: 'bg-orange-500',
  },
  disposed: {
    label: 'แทงจำหน่ายแล้ว',
    badgeClass: 'bg-slate-100 text-slate-700 border-slate-300',
    dotClass: 'bg-slate-500',
  },
  lost: {
    label: 'สูญหาย/รอตรวจสอบ',
    badgeClass: 'bg-rose-50 text-rose-800 border-rose-200',
    dotClass: 'bg-rose-500',
  },
};

export const BORROW_STATUS_META: Record<BorrowStatus, { label: string; badgeClass: string }> = {
  pending: { label: 'รออนุมัติ', badgeClass: 'bg-amber-50 text-amber-800 border-amber-200' },
  approved: { label: 'อนุมัติแล้ว (รอรับของ)', badgeClass: 'bg-blue-50 text-blue-800 border-blue-200' },
  rejected: { label: 'ไม่อนุมัติ', badgeClass: 'bg-rose-50 text-rose-800 border-rose-200' },
  borrowed: { label: 'กำลังยืมใช้งาน', badgeClass: 'bg-sky-50 text-sky-800 border-sky-200' },
  returned: { label: 'คืนครุภัณฑ์แล้ว', badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  overdue: { label: 'เกินกำหนดส่งคืน', badgeClass: 'bg-rose-100 text-rose-900 border-rose-300 font-semibold' },
  cancelled: { label: 'ยกเลิกคำขอ', badgeClass: 'bg-slate-100 text-slate-600 border-slate-200' },
};

export const TRANSFER_STATUS_META: Record<TransferStatus, { label: string; badgeClass: string }> = {
  pending: { label: 'รออนุมัติโอนย้าย', badgeClass: 'bg-amber-50 text-amber-800 border-amber-200' },
  approved: { label: 'อนุมัติโอนย้ายแล้ว', badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  rejected: { label: 'ไม่อนุมัติ', badgeClass: 'bg-rose-50 text-rose-800 border-rose-200' },
  cancelled: { label: 'ยกเลิก', badgeClass: 'bg-slate-100 text-slate-600 border-slate-200' },
};

export const MAINTENANCE_STATUS_META: Record<MaintenanceStatus, { label: string; badgeClass: string }> = {
  pending: { label: 'รอรับเรื่อง', badgeClass: 'bg-amber-50 text-amber-800 border-amber-200' },
  approved: { label: 'อนุมัติซ่อม', badgeClass: 'bg-blue-50 text-blue-800 border-blue-200' },
  in_progress: { label: 'กำลังดำเนินการซ่อม', badgeClass: 'bg-sky-50 text-sky-800 border-sky-200' },
  waiting_parts: { label: 'รออะไหล่', badgeClass: 'bg-purple-50 text-purple-800 border-purple-200' },
  completed: { label: 'ซ่อมเสร็จสิ้น', badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  unrepairable: { label: 'ซ่อมไม่ได้ (เสนอจำหน่าย)', badgeClass: 'bg-rose-50 text-rose-800 border-rose-200' },
  cancelled: { label: 'ยกเลิกใบแจ้งซ่อม', badgeClass: 'bg-slate-100 text-slate-600 border-slate-200' },
};

export const URGENCY_META: Record<MaintenanceUrgency, { label: string; badgeClass: string }> = {
  low: { label: 'ปกติ', badgeClass: 'bg-slate-100 text-slate-700 border-slate-200' },
  medium: { label: 'ปานกลาง', badgeClass: 'bg-blue-50 text-blue-700 border-blue-200' },
  high: { label: 'ด่วน', badgeClass: 'bg-amber-50 text-amber-800 border-amber-200' },
  critical: { label: 'ด่วนมาก (กระทบงานหลัก)', badgeClass: 'bg-rose-50 text-rose-800 border-rose-200' },
};

export const INVENTORY_RESULT_META: Record<
  InventoryResultStatus,
  { label: string; badgeClass: string }
> = {
  found_normal: { label: 'พบตามปกติ', badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  not_found: { label: 'ไม่พบครุภัณฑ์', badgeClass: 'bg-rose-50 text-rose-800 border-rose-200' },
  found_mismatch: { label: 'พบแต่สถานที่/ข้อมูลไม่ตรง', badgeClass: 'bg-amber-50 text-amber-800 border-amber-200' },
  damaged: { label: 'พบแต่ชำรุด', badgeClass: 'bg-orange-50 text-orange-800 border-orange-200' },
  needs_review: { label: 'ต้องตรวจสอบเพิ่มเติม', badgeClass: 'bg-purple-50 text-purple-800 border-purple-200' },
};

export const DISPOSAL_STATUS_META: Record<DisposalStatus, { label: string; badgeClass: string }> = {
  draft: { label: 'ร่างคำขอ', badgeClass: 'bg-slate-100 text-slate-700 border-slate-300' },
  submitted: { label: 'ส่งขออนุมัติ', badgeClass: 'bg-blue-50 text-blue-800 border-blue-200' },
  under_review: { label: 'อยู่ระหว่างคณะกรรมการพิจารณา', badgeClass: 'bg-amber-50 text-amber-800 border-amber-200' },
  approved: { label: 'อนุมัติให้จำหน่าย', badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  rejected: { label: 'ไม่อนุมัติ', badgeClass: 'bg-rose-50 text-rose-800 border-rose-200' },
  disposed: { label: 'ดำเนินการจำหน่ายเสร็จสิ้น', badgeClass: 'bg-slate-800 text-white border-slate-900' },
};

export const DISPOSAL_REASON_LABELS: Record<string, string> = {
  deteriorated: 'เสื่อมสภาพจากการใช้งานตามอายุ',
  damaged_beyond_repair: 'ชำรุดและซ่อมแซมไม่คุ้มค่า',
  obsolete: 'ล้าสมัยหรือหมดความจำเป็นในการใช้งานราชการ',
  lost: 'สูญหาย (ผ่านการสอบสวนตามระเบียบแล้ว)',
  other: 'เหตุผลอื่นตามระเบียบพัสดุ',
};

export const EVENT_CATEGORY_META: Record<EventCategory, { label: string; badgeClass: string }> = {
  meeting: { label: 'ประชุมคณะกรรมการพัสดุ', badgeClass: 'bg-blue-50 text-blue-800 border-blue-200' },
  inventory: { label: 'การตรวจนับครุภัณฑ์', badgeClass: 'bg-purple-50 text-purple-800 border-purple-200' },
  maintenance: { label: 'แผนซ่อมบำรุงตามรอบ', badgeClass: 'bg-amber-50 text-amber-800 border-amber-200' },
  training: { label: 'อบรม/ชี้แจงแนวปฏิบัติ', badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  due_date: { label: 'วันครบกำหนดคืน/สัญญา', badgeClass: 'bg-rose-50 text-rose-800 border-rose-200' },
  general: { label: 'กิจกรรมทั่วไป', badgeClass: 'bg-slate-100 text-slate-700 border-slate-200' },
};
