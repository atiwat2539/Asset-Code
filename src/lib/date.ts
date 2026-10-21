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
 * แปลงวันที่ ISO หรือ Date เป็นรูปแบบภาษาไทยย่อ เช่น "21 ต.ค. 2569"
 */
export function formatThaiDate(dateInput: string | Date | null | undefined): string {
  if (!dateInput) return '-';
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (Number.isNaN(date.getTime())) return '-';

  const day = date.getDate();
  const month = THAI_MONTHS_SHORT[date.getMonth()];
  const buddhistYear = toBuddhistYear(date.getFullYear());
  return `${day} ${month} ${buddhistYear}`;
}

/**
 * แปลงวันที่เป็นรูปแบบภาษาไทยเต็ม เช่น "21 ตุลาคม พ.ศ. 2569"
 */
export function formatThaiDateFull(dateInput: string | Date | null | undefined): string {
  if (!dateInput) return '-';
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (Number.isNaN(date.getTime())) return '-';

  const day = date.getDate();
  const month = THAI_MONTHS_FULL[date.getMonth()];
  const buddhistYear = toBuddhistYear(date.getFullYear());
  return `${day} ${month} พ.ศ. ${buddhistYear}`;
}

/**
 * แปลงวันและเวลาเป็นรูปแบบภาษาไทย เช่น "21 ต.ค. 2569 14:30 น."
 */
export function formatThaiDateTime(dateInput: string | Date | null | undefined): string {
  if (!dateInput) return '-';
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (Number.isNaN(date.getTime())) return '-';

  const datePart = formatThaiDate(date);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${datePart} ${hours}:${minutes} น.`;
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
  if (!targetDateStr) return null;
  const target = new Date(targetDateStr);
  if (Number.isNaN(target.getTime())) return null;

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
  const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (Number.isNaN(d.getTime())) return '';
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
