import { describe, expect, it } from 'vitest';
import {
  formatThaiDate,
  formatThaiDateFull,
  getThaiFiscalYear,
  toBuddhistYear,
} from '@/lib/date';
import { sanitizeSpreadsheetCell } from '@/lib/export';
import { sanitizeStorageFileName, validateUploadFile } from '@/lib/storage';
import { formatCurrency, translateSupabaseError } from '@/lib/utils';

describe('ระบบจัดการวันที่ไทยและปีงบประมาณ (src/lib/date.ts)', () => {
  it('แปลงปี ค.ศ. เป็น พ.ศ. ได้อย่างถูกต้องและไม่บวกซ้ำหากเป็น พ.ศ. อยู่แล้ว', () => {
    expect(toBuddhistYear(2026)).toBe(2569);
    expect(toBuddhistYear(2569)).toBe(2569);
  });

  it('แสดงผลวันที่ในรูปแบบย่อและเต็มภาษาไทยได้ตามมาตรฐานราชการ', () => {
    expect(formatThaiDate('2026-10-21')).toBe('21 ต.ค. 2569');
    expect(formatThaiDateFull('2026-10-21')).toBe('21 ตุลาคม พ.ศ. 2569');
    expect(formatThaiDate(null)).toBe('-');
  });

  it('คำนวณปีงบประมาณไทย (1 ต.ค. - 30 ก.ย.) ได้อย่างถูกต้อง', () => {
    // กันยายน 2026 ยังเป็นปีงบประมาณ 2569
    expect(getThaiFiscalYear(new Date(2026, 8, 15))).toBe(2569);
    // ตุลาคม 2026 เข้าสู่ปีงบประมาณ 2570
    expect(getThaiFiscalYear(new Date(2026, 9, 1))).toBe(2570);
  });
});

describe('การป้องกัน CSV / Spreadsheet Formula Injection (src/lib/export.ts)', () => {
  it('เติมเครื่องหมาย apostrophe นำหน้าข้อความที่ขึ้นต้นด้วยอักขระสูตรอันตราย (=, +, -, @)', () => {
    expect(sanitizeSpreadsheetCell('=CMD|\' /C calc\'!A0')).toBe('\'=CMD|\' /C calc\'!A0');
    expect(sanitizeSpreadsheetCell('+SUM(A1:A10)')).toBe('\'+SUM(A1:A10)');
    expect(sanitizeSpreadsheetCell('-100+200')).toBe('\'-100+200');
    expect(sanitizeSpreadsheetCell('@IMPORTXML()')).toBe('\'@IMPORTXML()');
  });

  it('ไม่ดัดแปลงข้อความครุภัณฑ์ปกติและตัวเลข', () => {
    expect(sanitizeSpreadsheetCell('กพท-7440-2569-0001')).toBe('กพท-7440-2569-0001');
    expect(sanitizeSpreadsheetCell(34500.5)).toBe(34500.5);
  });
});

describe('ความปลอดภัยในการจัดการชื่อไฟล์และประเภทไฟล์ Storage (src/lib/storage.ts)', () => {
  it('กรองอักขระอันตรายและ Path Traversal ออกจากชื่อไฟล์', () => {
    const cleaned = sanitizeStorageFileName('../../../etc/passwd.pdf');
    expect(cleaned).not.toContain('..');
    expect(cleaned).not.toContain('/');
    expect(cleaned.endsWith('.pdf')).toBe(true);
  });

  it('ตรวจสอบชนิดไฟล์และขนาดไฟล์ก่อนอัปโหลดตามนโยบาย Bucket', () => {
    const validImg = new File(['dummy'], 'asset.png', { type: 'image/png' });
    expect(() => validateUploadFile(validImg, 'asset-images')).not.toThrow();

    const invalidExe = new File(['dummy'], 'malware.exe', { type: 'application/x-msdownload' });
    expect(() => validateUploadFile(invalidExe, 'asset-images')).toThrow(/อนุญาตเฉพาะไฟล์รูปภาพ/);
    expect(() => validateUploadFile(invalidExe, 'asset-documents')).toThrow(/อนุญาตเฉพาะไฟล์ PDF/);
  });
});

describe('การจัดรูปแบบสกุลเงินและการแปลข้อความ Error จากฐานข้อมูล (src/lib/utils.ts)', () => {
  it('จัดรูปแบบจำนวนเงินเป็นบาทพร้อมทศนิยม 2 ตำแหน่ง', () => {
    expect(formatCurrency(34500)).toBe('34,500.00 บาท');
  });

  it('แปล Error เลขครุภัณฑ์ซ้ำ (Unique Constraint 23505) และ RLS Permission Denied (42501) เป็นภาษาไทย', () => {
    const dupErr = {
      code: '23505',
      message: 'duplicate key value violates unique constraint "assets_asset_code_key"',
    };
    expect(translateSupabaseError(dupErr)).toContain('เลขครุภัณฑ์นี้มีอยู่ในระบบแล้ว');

    const rlsErr = {
      code: '42501',
      message: 'new row violates row-level security policy for table "assets"',
    };
    expect(translateSupabaseError(rlsErr)).toContain('คุณไม่มีสิทธิ์ดำเนินการรายการนี้');
  });
});
