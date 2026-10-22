import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { formatThaiDateTime, getBuddhistDateStamp } from './date';

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

let cachedRegularBase64: string | null = null;
let cachedBoldBase64: string | null = null;

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

async function loadThaiFontsForPdf(doc: jsPDF): Promise<boolean> {
  try {
    if (!cachedRegularBase64 || !cachedBoldBase64) {
      const [regRes, boldRes] = await Promise.all([
        fetch('/fonts/Sarabun-Regular.ttf'),
        fetch('/fonts/Sarabun-Bold.ttf'),
      ]);
      if (!regRes.ok || !boldRes.ok) {
        return false;
      }
      const [regBuf, boldBuf] = await Promise.all([
        regRes.arrayBuffer(),
        boldRes.arrayBuffer(),
      ]);
      cachedRegularBase64 = arrayBufferToBase64(regBuf);
      cachedBoldBase64 = arrayBufferToBase64(boldBuf);
    }

    doc.addFileToVFS('Sarabun-Regular.ttf', cachedRegularBase64);
    doc.addFont('Sarabun-Regular.ttf', 'Sarabun', 'normal');
    doc.addFileToVFS('Sarabun-Bold.ttf', cachedBoldBase64);
    doc.addFont('Sarabun-Bold.ttf', 'Sarabun', 'bold');
    doc.setFont('Sarabun', 'normal');
    return true;
  } catch {
    return false;
  }
}

/**
 * ส่งออกข้อมูลเป็นไฟล์ Excel (.xlsx) พร้อมหัวรายงานหน่วยงานราชการ วันที่ออกรายงาน และตัวกรองที่ใช้
 */
export function exportToExcel<T extends Record<string, unknown>>(
  rows: T[],
  columns: { key: keyof T; header: string }[],
  meta: ExportMetaOptions
): void {
  const orgName = meta.orgName || 'สำนักหอสมุด มหาวิทยาลัยเชียงใหม่ (CMU Library)';
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

  const dateStamp = getBuddhistDateStamp(new Date());
  XLSX.writeFile(workbook, `${meta.fileNamePrefix}_${dateStamp}.xlsx`);
}

/**
 * ส่งออกรายงานเป็นไฟล์ PDF รองรับภาษาไทย 100% (ฟอนต์ Sarabun) พร้อมแสดงหัวกระดาษ ชื่อหน่วยงาน ตัวกรอง และเลขหน้า
 */
export async function exportToPDF<T extends Record<string, unknown>>(
  rows: T[],
  columns: { key: keyof T; header: string }[],
  meta: ExportMetaOptions
): Promise<void> {
  const orgName = meta.orgName || 'สำนักหอสมุด มหาวิทยาลัยเชียงใหม่ (CMU Library)';
  const generatedAt = formatThaiDateTime(new Date());

  const doc = new jsPDF({
    orientation: columns.length > 5 ? 'landscape' : 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const hasThaiFont = await loadThaiFontsForPdf(doc);
  const fontName = hasThaiFont ? 'Sarabun' : 'helvetica';

  doc.setFont(fontName, 'bold');
  doc.setFontSize(15);
  doc.text(orgName, 14, 15);

  doc.setFont(fontName, 'bold');
  doc.setFontSize(12);
  doc.text(meta.reportTitle, 14, 22);

  doc.setFont(fontName, 'normal');
  doc.setFontSize(9.5);
  doc.text(
    `วันที่ออกรายงาน: ${generatedAt}   |   เงื่อนไขตัวกรอง: ${meta.filtersSummary || 'ทั้งหมด'}`,
    14,
    28
  );

  const tableHeaders = [columns.map((c) => c.header)];
  const tableBody = rows.map((row) =>
    columns.map((col) => {
      const val = row[col.key];
      if (typeof val === 'number') {
        return val.toLocaleString('th-TH');
      }
      return val === null || val === undefined ? '-' : String(val);
    })
  );

  autoTable(doc, {
    startY: 33,
    head: tableHeaders,
    body: tableBody,
    styles: {
      font: fontName,
      fontStyle: 'normal',
      fontSize: 9,
      cellPadding: 2.5,
      textColor: [30, 41, 59],
    },
    headStyles: {
      font: fontName,
      fontStyle: 'bold',
      fontSize: 9.5,
      fillColor: [95, 75, 139], // PANTONE 18-3838 Ultra Violet (#5F4B8B)
      textColor: 255,
    },
    alternateRowStyles: {
      fillColor: [246, 245, 250],
    },
    didDrawPage: (data) => {
      const pageCount = doc.getNumberOfPages();
      const pageSize = doc.internal.pageSize;
      const pageHeight = pageSize.height ? pageSize.height : pageSize.getHeight();
      doc.setFont(fontName, 'normal');
      doc.setFontSize(8.5);
      doc.text(
        `หน้า ${data.pageNumber} จาก ${pageCount}`,
        pageSize.width - 35,
        pageHeight - 10
      );
    },
  });

  const dateStamp = getBuddhistDateStamp(new Date());
  doc.save(`${meta.fileNamePrefix}_${dateStamp}.pdf`);
}

export const SAMPLE_ASSET_IMPORT_ROWS = [
  {
    'เลขครุภัณฑ์': 'กพท-7440-2569-0101',
    'ชื่อครุภัณฑ์': 'เครื่องคอมพิวเตอร์โน้ตบุ๊ก สำหรับงานประมวลผล',
    'หมวดหมู่ครุภัณฑ์': '7440',
    'สถานะครุภัณฑ์': 'พร้อมใช้งาน',
    'ยี่ห้อ (Brand)': 'Dell',
    'รุ่น (Model)': 'Latitude 5440',
    'หมายเลขเครื่อง (Serial Number)': 'DL5440-TH-9001',
    'ราคาต่อหน่วย (บาท)': 28500,
    'วันที่รับเข้า / วันที่ตรวจรับ': '15/10/2569',
    'เลขที่สัญญาจัดซื้อ / ใบตรวจรับ': 'สญ.021/2569',
    'หน่วยงาน/กองผู้ครอบครอง': 'ITD',
    'อาคาร / ห้อง / สถานที่ตั้ง': 'BLD-A-405',
    'ผู้รับผิดชอบดูแลครุภัณฑ์': '',
    'อายุการใช้งานโดยประมาณ (ปี)': 5,
    'คุณลักษณะเฉพาะ / รายละเอียด': 'Intel Core i7, RAM 16GB, SSD 512GB',
    'หมายเหตุ': 'ครุภัณฑ์ประจำศูนย์เทคโนโลยีสารสนเทศ',
  },
  {
    'เลขครุภัณฑ์': 'กพท-7440-2569-0102',
    'ชื่อครุภัณฑ์': 'เครื่องพิมพ์เลเซอร์สีเครือข่าย (Network Color Laser Printer)',
    'หมวดหมู่ครุภัณฑ์': '7440',
    'สถานะครุภัณฑ์': 'พร้อมใช้งาน',
    'ยี่ห้อ (Brand)': 'HP',
    'รุ่น (Model)': 'Color LaserJet Enterprise M455dn',
    'หมายเลขเครื่อง (Serial Number)': 'HP455-TH-9002',
    'ราคาต่อหน่วย (บาท)': 19800,
    'วันที่รับเข้า / วันที่ตรวจรับ': '',
    'เลขที่สัญญาจัดซื้อ / ใบตรวจรับ': 'สญ.021/2569',
    'หน่วยงาน/กองผู้ครอบครอง': 'FAD',
    'อาคาร / ห้อง / สถานที่ตั้ง': 'BLD-A-201',
    'ผู้รับผิดชอบดูแลครุภัณฑ์': '',
    'อายุการใช้งานโดยประมาณ (ปี)': 5,
    'คุณลักษณะเฉพาะ / รายละเอียด': 'พิมพ์สีสองหน้าอัตโนมัติ รองรับระบบเครือข่าย LAN',
    'หมายเหตุ': 'ใช้งานส่วนกลางกลุ่มงานบริหารพัสดุ',
  },
  {
    'เลขครุภัณฑ์': 'กพท-7110-2569-0103',
    'ชื่อครุภัณฑ์': 'โต๊ะทำงานระดับปฏิบัติการ พร้อมตู้ลิ้นชัก 3 ชั้น',
    'หมวดหมู่ครุภัณฑ์': '7110',
    'สถานะครุภัณฑ์': 'พร้อมใช้งาน',
    'ยี่ห้อ (Brand)': 'Modernform',
    'รุ่น (Model)': 'MF-Exec-150',
    'หมายเลขเครื่อง (Serial Number)': 'MF150-2569-03',
    'ราคาต่อหน่วย (บาท)': 8900,
    'วันที่รับเข้า / วันที่ตรวจรับ': '',
    'เลขที่สัญญาจัดซื้อ / ใบตรวจรับ': 'สญ.022/2569',
    'หน่วยงาน/กองผู้ครอบครอง': 'GAD',
    'อาคาร / ห้อง / สถานที่ตั้ง': 'BLD-B-102',
    'ผู้รับผิดชอบดูแลครุภัณฑ์': '',
    'อายุการใช้งานโดยประมาณ (ปี)': 5,
    'คุณลักษณะเฉพาะ / รายละเอียด': 'ขนาด 150x75x75 ซม. โครงเหล็กหน้าไม้เมลามีน',
    'หมายเหตุ': '',
  },
  {
    'เลขครุภัณฑ์': 'กพท-7730-2569-0104',
    'ชื่อครุภัณฑ์': 'เครื่องฉายภาพโปรเจคเตอร์ เลเซอร์ ความสว่าง 5,000 Lumens',
    'หมวดหมู่ครุภัณฑ์': '7730',
    'สถานะครุภัณฑ์': 'พร้อมใช้งาน',
    'ยี่ห้อ (Brand)': 'Epson',
    'รุ่น (Model)': 'EB-L530U',
    'หมายเลขเครื่อง (Serial Number)': 'EPS530-TH-9004',
    'ราคาต่อหน่วย (บาท)': 64000,
    'วันที่รับเข้า / วันที่ตรวจรับ': '20/10/2569',
    'เลขที่สัญญาจัดซื้อ / ใบตรวจรับ': 'สญ.025/2569',
    'หน่วยงาน/กองผู้ครอบครอง': 'PLD',
    'อาคาร / ห้อง / สถานที่ตั้ง': 'BLD-A-302',
    'ผู้รับผิดชอบดูแลครุภัณฑ์': '',
    'อายุการใช้งานโดยประมาณ (ปี)': 5,
    'คุณลักษณะเฉพาะ / รายละเอียด': 'ความสว่าง 5,200 Lumens ความละเอียด WUXGA',
    'หมายเหตุ': 'ติดตั้งประจำห้องประชุม',
  },
];

/**
 * ดาวน์โหลดไฟล์ตัวอย่างสำหรับนำเข้าข้อมูลครุภัณฑ์ (.xlsx หรือ .csv รองรับ UTF-8 BOM สำหรับเปิดใน Excel ภาษาไทย)
 */
export function downloadAssetImportTemplate(format: 'xlsx' | 'csv' = 'xlsx'): void {
  const worksheet = XLSX.utils.json_to_sheet(SAMPLE_ASSET_IMPORT_ROWS);
  worksheet['!cols'] = [
    { wch: 22 }, // เลขครุภัณฑ์
    { wch: 45 }, // ชื่อครุภัณฑ์
    { wch: 18 }, // หมวดหมู่ครุภัณฑ์
    { wch: 18 }, // สถานะครุภัณฑ์
    { wch: 16 }, // ยี่ห้อ (Brand)
    { wch: 26 }, // รุ่น (Model)
    { wch: 24 }, // หมายเลขเครื่อง (Serial Number)
    { wch: 18 }, // ราคาต่อหน่วย (บาท)
    { wch: 24 }, // วันที่รับเข้า / วันที่ตรวจรับ
    { wch: 24 }, // เลขที่สัญญาจัดซื้อ / ใบตรวจรับ
    { wch: 22 }, // หน่วยงาน/กองผู้ครอบครอง
    { wch: 24 }, // อาคาร / ห้อง / สถานที่ตั้ง
    { wch: 24 }, // ผู้รับผิดชอบดูแลครุภัณฑ์
    { wch: 24 }, // อายุการใช้งานโดยประมาณ (ปี)
    { wch: 36 }, // คุณลักษณะเฉพาะ / รายละเอียด
    { wch: 28 }, // หมายเหตุ
  ];

  if (format === 'csv') {
    const csvContent = XLSX.utils.sheet_to_csv(worksheet);
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'sample_assets_import_template.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    return;
  }

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'AssetImportTemplate');
  XLSX.writeFile(workbook, 'sample_assets_import_template.xlsx');
}
