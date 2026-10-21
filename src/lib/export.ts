import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { formatThaiDateTime } from './date';

/**
 * ป้องกัน CSV / Spreadsheet Formula Injection (OWASP CSV Injection)
 * หากข้อความขึ้นต้นด้วย =, +, -, @, Tab หรือ Carriage Return จะเติม apostrophe (') นำหน้า
 */
export function sanitizeSpreadsheetCell(value: unknown): string | number | boolean {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return value;

  const str = String(value);
  if (/^[=+\-@\t\r]/.test(str)) {
    return `'${str}`;
  }
  return str;
}

export interface ExportMetaOptions {
  reportTitle: string;
  orgName?: string;
  filtersSummary?: string;
  fileNamePrefix: string;
}

/**
 * ส่งออกข้อมูลเป็นไฟล์ Excel (.xlsx) พร้อมหัวรายงานหน่วยงานราชการ วันที่ออกรายงาน และตัวกรองที่ใช้
 */
export function exportToExcel<T extends Record<string, unknown>>(
  rows: T[],
  columns: { key: keyof T; header: string }[],
  meta: ExportMetaOptions
): void {
  const orgName = meta.orgName || 'สำนักงานบริหารงานพัสดุและครุภัณฑ์กลาง';
  const generatedAt = formatThaiDateTime(new Date());

  const headerInfoRows = [
    [sanitizeSpreadsheetCell(orgName)],
    [sanitizeSpreadsheetCell(meta.reportTitle)],
    [sanitizeSpreadsheetCell(`วันที่ออกรายงาน: ${generatedAt}`)],
    [sanitizeSpreadsheetCell(`ตัวกรองข้อมูล: ${meta.filtersSummary || 'ทั้งหมด'}`)],
    [],
    columns.map((c) => sanitizeSpreadsheetCell(c.header)),
  ];

  const dataRows = rows.map((row) =>
    columns.map((col) => sanitizeSpreadsheetCell(row[col.key]))
  );

  const worksheet = XLSX.utils.aoa_to_sheet([...headerInfoRows, ...dataRows]);

  // ปรับความกว้างคอลัมน์ให้อ่านง่าย
  worksheet['!cols'] = columns.map((col) => ({
    wch: Math.max(col.header.length + 8, 18),
  }));

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'รายงานพัสดุ');

  const dateStamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(workbook, `${meta.fileNamePrefix}_${dateStamp}.xlsx`);
}

/**
 * ส่งออกรายงานเป็นไฟล์ PDF พร้อมรองรับการพิมพ์และแสดงหัวกระดาษ ชื่อหน่วยงาน ตัวกรอง และเลขหน้า
 */
export function exportToPDF<T extends Record<string, unknown>>(
  rows: T[],
  columns: { key: keyof T; header: string }[],
  meta: ExportMetaOptions
): void {
  const orgName = meta.orgName || 'สำนักงานบริหารงานพัสดุและครุภัณฑ์กลาง';
  const generatedAt = formatThaiDateTime(new Date());

  const doc = new jsPDF({
    orientation: columns.length > 5 ? 'landscape' : 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  // เนื่องจาก jsPDF มาตรฐานอาจไม่ฝังฟอนต์ภาษาไทยขนาดใหญ่ เราจึงสร้างทั้งไฟล์ PDF มาตรฐาน
  // และรองรับตารางข้อมูลพร้อมเลขหน้าอย่างครบถ้วน
  doc.setFontSize(14);
  doc.text(orgName, 14, 15);
  doc.setFontSize(11);
  doc.text(meta.reportTitle, 14, 22);
  doc.setFontSize(9);
  doc.text(`Generated: ${generatedAt} | Filter: ${meta.filtersSummary || 'All'}`, 14, 28);

  const tableHeaders = [columns.map((c) => c.header)];
  const tableBody = rows.map((row) =>
    columns.map((col) => {
      const val = row[col.key];
      return val === null || val === undefined ? '-' : String(val);
    })
  );

  autoTable(doc, {
    startY: 33,
    head: tableHeaders,
    body: tableBody,
    styles: {
      fontSize: 8,
      cellPadding: 2.5,
    },
    headStyles: {
      fillColor: [30, 58, 138], // สีน้ำเงินราชการ #1e3a8a
      textColor: 255,
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    didDrawPage: (data) => {
      const pageCount = doc.getNumberOfPages();
      const pageSize = doc.internal.pageSize;
      const pageHeight = pageSize.height ? pageSize.height : pageSize.getHeight();
      doc.setFontSize(8);
      doc.text(
        `Page ${data.pageNumber} of ${pageCount}`,
        pageSize.width - 35,
        pageHeight - 10
      );
    },
  });

  const dateStamp = new Date().toISOString().slice(0, 10);
  doc.save(`${meta.fileNamePrefix}_${dateStamp}.pdf`);
}
