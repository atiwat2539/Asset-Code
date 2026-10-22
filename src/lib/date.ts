const THAI_MONTHS_SHORT = [
  'ม.ค.',
  'ก.พ.',
  'มี.ค.',
  'เม.ย.',
  'พ.ค.',
  'มิ.ย.',
  'ก.ค.',
  'ส.ค.',
  'ก.ย.',
  'ต.ค.',
  'พ.ย.',
  'ธ.ค.',
];

const THAI_MONTHS_FULL = [
  'มกราคม',
  'กุมภาพันธ์',
  'มีนาคม',
  'เมษายน',
  'พฤษภาคม',
  'มิถุนายน',
  'กรกฎาคม',
  'สิงหาคม',
  'กันยายน',
  'ตุลาคม',
  'พฤศจิกายน',
  'ธันวาคม',
];

/**
 * แปลงปี ค.ศ. เป็น พ.ศ. (+543)
 * หากค่าที่ส่งเข้ามาเป็น พ.ศ. อยู่แล้ว (>= 2400) จะคืนค่าเดิมเพื่อความสม่ำเสมอ
 */
export function toBuddhistYear(ceYear: number): number {
  if (ceYear >= 2400) return ceYear;
  return ceYear + 543;
}

/**
 * แปลงค่าวันที่หลากหลายรูปแบบ (ISO ค.ศ., ISO พ.ศ. เช่น 2569-10-15, หรือ วว/ดด/ปปปป) ให้เป็น Date Object ที่ถูกต้อง
 */
export function parseThaiOrISODate(dateInput: string | Date | null | undefined): Date | null {
  if (!dateInput) return null;
  if (dateInput instanceof Date) {
    return Number.isNaN(dateInput.getTime()) ? null : dateInput;
  }

  const trimmed = String(dateInput).trim();
  if (!trimmed) return null;

  // รูปแบบ YYYY-MM-DD (รองรับทั้ง ค.ศ. และ พ.ศ.)
  const isoMatch = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) {
    let year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]);
    const day = Number(isoMatch[3]);
    if (year >= 2400) year -= 543;
    const d = new Date(year, month - 1, day);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // รูปแบบ DD/MM/YYYY หรือ DD-MM-YYYY (รองรับทั้ง พ.ศ. และ ค.ศ.)
  const dmyMatch = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmyMatch) {
    const day = Number(dmyMatch[1]);
    const month = Number(dmyMatch[2]);
    let year = Number(dmyMatch[3]);
    if (year >= 2400) year -= 543;
    const d = new Date(year, month - 1, day);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const fallback = new Date(trimmed);
  if (Number.isNaN(fallback.getTime())) return null;
  if (fallback.getFullYear() >= 2400) {
    fallback.setFullYear(fallback.getFullYear() - 543);
  }
  return fallback;
}

/**
 * แปลงข้อความวันที่จากไฟล์นำเข้า (ทั้ง พ.ศ. เช่น 15/10/2569, 2569-10-15 หรือ ค.ศ. 2026-10-15)
 * ให้เป็น YYYY-MM-DD (ค.ศ.) สำหรับบันทึกลงฐานข้อมูล PostgreSQL DATE
 */
export function normalizeToISODate(dateInput: string | number | Date | null | undefined): string {
  if (dateInput === null || dateInput === undefined || dateInput === '') return '';

  // กรณีเป็นตัวเลข Serial Date ของ Excel
  if (typeof dateInput === 'number' && dateInput > 20000 && dateInput < 100000) {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    const parsedExcel = new Date(excelEpoch.getTime() + dateInput * 86400000);
    if (!Number.isNaN(parsedExcel.getTime())) {
      let y = parsedExcel.getUTCFullYear();
      if (y >= 2400) y -= 543;
      const m = String(parsedExcel.getUTCMonth() + 1).padStart(2, '0');
      const d = String(parsedExcel.getUTCDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
  }

  const parsed = parseThaiOrISODate(dateInput as string | Date);
  if (!parsed) return '';
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * แปลงวันที่ ISO หรือ Date เป็นรูปแบบภาษาไทยย่อ พ.ศ. เช่น "21 ต.ค. 2569"
 */
export function formatThaiDate(dateInput: string | Date | null | undefined): string {
  const date = parseThaiOrISODate(dateInput);
  if (!date) return '-';

  const day = date.getDate();
  const month = THAI_MONTHS_SHORT[date.getMonth()];
  const buddhistYear = toBuddhistYear(date.getFullYear());
  return `${day} ${month} ${buddhistYear}`;
}

/**
 * แปลงวันที่เป็นรูปแบบตัวเลข วว/ดด/ปปปป (พ.ศ.) เช่น "21/10/2569"
 */
export function formatThaiDateNumeric(dateInput: string | Date | null | undefined): string {
  const date = parseThaiOrISODate(dateInput);
  if (!date) return '-';

  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const buddhistYear = toBuddhistYear(date.getFullYear());
  return `${day}/${month}/${buddhistYear}`;
}

/**
 * แปลงวันที่เป็นรูปแบบภาษาไทยเต็ม เช่น "21 ตุลาคม พ.ศ. 2569"
 */
export function formatThaiDateFull(dateInput: string | Date | null | undefined): string {
  const date = parseThaiOrISODate(dateInput);
  if (!date) return '-';

  const day = date.getDate();
  const month = THAI_MONTHS_FULL[date.getMonth()];
  const buddhistYear = toBuddhistYear(date.getFullYear());
  return `${day} ${month} พ.ศ. ${buddhistYear}`;
}

/**
 * แปลงวันและเวลาเป็นรูปแบบภาษาไทย พ.ศ. เช่น "21 ต.ค. 2569 14:30 น."
 */
export function formatThaiDateTime(dateInput: string | Date | null | undefined): string {
  const date = parseThaiOrISODate(dateInput);
  if (!date) return '-';

  const datePart = formatThaiDate(date);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${datePart} ${hours}:${minutes} น.`;
}

/**
 * คืนค่ารหัสวันที่ปัจจุบันในรูปแบบ พ.ศ. YYYY-MM-DD เช่น "2569-10-22" สำหรับตั้งชื่อไฟล์ส่งออก
 */
export function getBuddhistDateStamp(dateInput: Date = new Date()): string {
  const beYear = toBuddhistYear(dateInput.getFullYear());
  const month = String(dateInput.getMonth() + 1).padStart(2, '0');
  const day = String(dateInput.getDate()).padStart(2, '0');
  return `${beYear}-${month}-${day}`;
}

/**
 * คำนวณปีงบประมาณไทย (1 ต.ค. - 30 ก.ย.)
 * หากเดือนตั้งแต่ตุลาคมขึ้นไป จะนับเป็นปีงบประมาณถัดไป
 */
export function getThaiFiscalYear(dateInput: Date = new Date()): number {
  const yearCE = dateInput.getFullYear();
  const monthIndex = dateInput.getMonth(); // 0 = ม.ค., 9 = ต.ค.
  const fiscalYearCE = monthIndex >= 9 ? yearCE + 1 : yearCE;
  return toBuddhistYear(fiscalYearCE);
}

/**
 * คำนวณจำนวนวันที่เหลือจนถึงวันครบกำหนด (ค่าติดลบคือเกินกำหนด)
 */
export function getDaysRemaining(targetDateStr: string | null | undefined): number | null {
  const target = parseThaiOrISODate(targetDateStr);
  if (!target) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);

  const diffMs = target.getTime() - today.getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * คืนค่าวันที่ปัจจุบันในรูปแบบ YYYY-MM-DD สำหรับใส่ใน <input type="date" />
 */
export function toISODateInput(dateInput: string | Date = new Date()): string {
  const d = parseThaiOrISODate(dateInput);
  if (!d) return '';
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
