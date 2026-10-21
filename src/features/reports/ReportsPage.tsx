import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  FileSpreadsheet,
  FileText,
  FileBarChart2,
} from 'lucide-react';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import {
  ASSET_STATUS_META,
  BORROW_STATUS_META,
  DISPOSAL_REASON_LABELS,
  DISPOSAL_STATUS_META,
  formatCurrency,
  INVENTORY_RESULT_META,
  MAINTENANCE_STATUS_META,
  TRANSFER_STATUS_META,
  translateSupabaseError,
} from '@/lib/utils';
import { formatThaiDate, formatThaiDateTime } from '@/lib/date';
import { exportToExcel, exportToPDF } from '@/lib/export';
import { useCategories, useDepartments, useSystemSettings } from '@/hooks/useMasterData';
import { ErrorState, LoadingState, PageHeader } from '@/components/ui/common';

type ReportTypeKey =
  | 'all_assets'
  | 'by_category_dept'
  | 'valuation'
  | 'inventory'
  | 'overdue_borrow'
  | 'transfers'
  | 'maintenance_cost'
  | 'disposal'
  | 'audit_trail';

const REPORT_TYPES: { key: ReportTypeKey; title: string; description: string }[] = [
  {
    key: 'all_assets',
    title: '1. รายงานทะเบียนครุภัณฑ์ทั้งหมด',
    description: 'แสดงรายการครุภัณฑ์ทั้งหมดพร้อมรหัส ยี่ห้อ รุ่น สถานที่ตั้ง และผู้รับผิดชอบ',
  },
  {
    key: 'by_category_dept',
    title: '2. รายงานครุภัณฑ์แยกตามประเภท / หน่วยงาน / สถานะ',
    description: 'สรุปรายการครุภัณฑ์ตามตัวกรองหมวดหมู่ กอง/สำนัก และสถานะความพร้อมใช้งาน',
  },
  {
    key: 'valuation',
    title: '3. รายงานมูลค่าครุภัณฑ์และอายุการใช้งาน',
    description: 'แสดงราคาทุน อายุการใช้งาน อัตราค่าเสื่อมราคาเบื้องต้น และมูลค่ารวมตามหมวดหมู่',
  },
  {
    key: 'inventory',
    title: '4. รายงานผลการตรวจนับครุภัณฑ์ประจำปี',
    description: 'รายงานผลการตรวจนับพัสดุประจำปี สถานที่พบจริง และรายการชำรุด/ไม่พบ',
  },
  {
    key: 'overdue_borrow',
    title: '5. รายงานการยืมค้างคืนและเกินกำหนดส่งคืน',
    description: 'ติดตามรายการครุภัณฑ์ที่อยู่ระหว่างยืมใช้งานและรายการที่เกินกำหนดส่งคืน',
  },
  {
    key: 'transfers',
    title: '6. รายงานประวัติการโอนย้ายครุภัณฑ์',
    description: 'รายงานการโอนย้ายหน่วยงาน อาคาร/ห้อง และผู้รับผิดชอบดูแลครุภัณฑ์',
  },
  {
    key: 'maintenance_cost',
    title: '7. รายงานการซ่อมบำรุงและค่าใช้จ่ายสะสม',
    description: 'สรุปประวัติใบแจ้งซ่อม ผู้ให้บริการ และค่าใช้จ่ายในการซ่อมบำรุงจริง',
  },
  {
    key: 'disposal',
    title: '8. รายงานคำขอจำหน่าย / แทงจำหน่ายครุภัณฑ์',
    description: 'รายงานรายการครุภัณฑ์ที่เสนอขอจำหน่าย เหตุผล เลขที่เอกสารอนุมัติ และมูลค่าซาก',
  },
  {
    key: 'audit_trail',
    title: '9. รายงานประวัติการดำเนินการสำคัญ (Audit Trail Report)',
    description: 'บันทึกการกระทำสำคัญในระบบตามสิทธิ์การเข้าถึงเพื่อการตรวจสอบภายใน',
  },
];

export function ReportsPage() {
  const configured = isSupabaseConfigured();
  const { data: settings } = useSystemSettings();
  const { data: departments = [] } = useDepartments();
  const { data: categories = [] } = useCategories();

  const [selectedReport, setSelectedReport] = useState<ReportTypeKey>('all_assets');
  const [deptFilter, setDeptFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const { data: rawData, isLoading, error, refetch } = useQuery({
    queryKey: ['reports-dataset'],
    queryFn: async () => {
      if (!configured) return null;
      const [
        assetsRes,
        inventoryRes,
        borrowsRes,
        transfersRes,
        maintenanceRes,
        disposalRes,
        auditRes,
      ] = await Promise.all([
        supabase
          .from('assets')
          .select('*, category:asset_categories(*), department:departments(*), location:locations(*), custodian:profiles!assets_custodian_id_fkey(*)')
          .eq('is_archived', false)
          .order('asset_code', { ascending: true }),
        supabase
          .from('inventory_items')
          .select('*, session:inventory_sessions(*), asset:assets(*), actual_location:locations!inventory_items_actual_location_id_fkey(*), inspector:profiles!inventory_items_inspected_by_fkey(*)')
          .order('inspected_at', { ascending: false }),
        supabase
          .from('borrow_requests')
          .select('*, asset:assets(*), requester:profiles!borrow_requests_requester_id_fkey(*), department:departments(*)')
          .order('expected_return_date', { ascending: true }),
        supabase
          .from('asset_transfers')
          .select('*, asset:assets(*), from_department:departments!asset_transfers_from_department_id_fkey(*), to_department:departments!asset_transfers_to_department_id_fkey(*)')
          .order('effective_date', { ascending: false }),
        supabase
          .from('maintenance_requests')
          .select('*, asset:assets(*), reporter:profiles!maintenance_requests_reported_by_fkey(*)')
          .order('reported_date', { ascending: false }),
        supabase
          .from('disposal_requests')
          .select('*, asset:assets(*), proposer:profiles!disposal_requests_proposed_by_fkey(*)')
          .order('proposed_date', { ascending: false }),
        supabase
          .from('audit_logs')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(200),
      ]);

      if (assetsRes.error) throw assetsRes.error;

      return {
        assets: assetsRes.data || [],
        inventory: inventoryRes.data || [],
        borrows: borrowsRes.data || [],
        transfers: transfersRes.data || [],
        maintenances: maintenanceRes.data || [],
        disposals: disposalRes.data || [],
        audits: auditRes.data || [],
      };
    },
  });

  // สร้างแถวและคอลัมน์ตามประเภทรายงานที่เลือก
  const reportTable = useMemo<{
    columns: { key: string; header: string }[];
    rows: Record<string, unknown>[];
  }>(() => {
    if (!rawData) return { columns: [], rows: [] };

    const filteredAssets = rawData.assets.filter((a) => {
      if (deptFilter && a.department_id !== deptFilter) return false;
      if (categoryFilter && a.category_id !== categoryFilter) return false;
      if (statusFilter && a.status !== statusFilter) return false;
      return true;
    });

    switch (selectedReport) {
      case 'all_assets':
      case 'by_category_dept':
        return {
          columns: [
            { key: 'seq', header: 'ลำดับ' },
            { key: 'asset_code', header: 'เลขครุภัณฑ์' },
            { key: 'name', header: 'ชื่อครุภัณฑ์' },
            { key: 'category', header: 'หมวดหมู่' },
            { key: 'department', header: 'หน่วยงาน' },
            { key: 'location', header: 'สถานที่ตั้ง' },
            { key: 'custodian', header: 'ผู้รับผิดชอบ' },
            { key: 'acquired_date', header: 'วันที่รับเข้า' },
            { key: 'unit_price', header: 'ราคาทุน (บาท)' },
            { key: 'status', header: 'สถานะ' },
          ],
          rows: filteredAssets.map((a, idx) => ({
            seq: idx + 1,
            asset_code: a.asset_code,
            name: a.name,
            category: a.category?.name || '-',
            department: a.department?.name || '-',
            location: a.location ? `${a.location.building} ${a.location.room || ''}`.trim() : '-',
            custodian: a.custodian?.full_name || '-',
            acquired_date: formatThaiDate(a.acquired_date),
            unit_price: formatCurrency(a.unit_price),
            status: ASSET_STATUS_META[a.status as keyof typeof ASSET_STATUS_META]?.label || a.status,
          })),
        };

      case 'valuation':
        return {
          columns: [
            { key: 'seq', header: 'ลำดับ' },
            { key: 'asset_code', header: 'เลขครุภัณฑ์' },
            { key: 'name', header: 'รายการครุภัณฑ์' },
            { key: 'category', header: 'หมวดหมู่' },
            { key: 'acquired_date', header: 'วันที่รับเข้า' },
            { key: 'useful_life', header: 'อายุใช้งาน (ปี)' },
            { key: 'unit_price', header: 'ราคาทุน (บาท)' },
            { key: 'contract_no', header: 'เลขที่สัญญา' },
            { key: 'status', header: 'สถานะปัจจุบัน' },
          ],
          rows: filteredAssets.map((a, idx) => ({
            seq: idx + 1,
            asset_code: a.asset_code,
            name: a.name,
            category: a.category?.name || '-',
            acquired_date: formatThaiDate(a.acquired_date),
            useful_life: a.useful_life_years || a.category?.useful_life_years || 5,
            unit_price: formatCurrency(a.unit_price),
            contract_no: a.contract_number || '-',
            status: ASSET_STATUS_META[a.status as keyof typeof ASSET_STATUS_META]?.label || a.status,
          })),
        };

      case 'inventory':
        return {
          columns: [
            { key: 'seq', header: 'ลำดับ' },
            { key: 'session', header: 'รอบตรวจนับ' },
            { key: 'asset_code', header: 'เลขครุภัณฑ์' },
            { key: 'asset_name', header: 'ชื่อครุภัณฑ์' },
            { key: 'actual_location', header: 'สถานที่พบจริง' },
            { key: 'result', header: 'ผลการตรวจนับ' },
            { key: 'inspector', header: 'ผู้ตรวจนับ' },
            { key: 'inspected_at', header: 'วันเวลาตรวจนับ' },
          ],
          rows: rawData.inventory.map((item, idx) => ({
            seq: idx + 1,
            session: item.session?.session_code || '-',
            asset_code: item.asset?.asset_code || '-',
            asset_name: item.asset?.name || '-',
            actual_location: item.actual_location?.name || '-',
            result:
              INVENTORY_RESULT_META[item.result_status as keyof typeof INVENTORY_RESULT_META]?.label ||
              item.result_status,
            inspector: item.inspector?.full_name || '-',
            inspected_at: formatThaiDateTime(item.inspected_at),
          })),
        };

      case 'overdue_borrow':
        return {
          columns: [
            { key: 'seq', header: 'ลำดับ' },
            { key: 'request_no', header: 'เลขที่ใบยืม' },
            { key: 'asset_code', header: 'เลขครุภัณฑ์' },
            { key: 'asset_name', header: 'ชื่อครุภัณฑ์' },
            { key: 'requester', header: 'ผู้ยืม' },
            { key: 'borrow_date', header: 'วันที่ยืม' },
            { key: 'expected_return', header: 'กำหนดส่งคืน' },
            { key: 'status', header: 'สถานะ' },
          ],
          rows: rawData.borrows
            .filter((b) => ['pending', 'approved', 'borrowed', 'overdue'].includes(b.status))
            .map((b, idx) => ({
              seq: idx + 1,
              request_no: b.request_no,
              asset_code: b.asset?.asset_code || '-',
              asset_name: b.asset?.name || '-',
              requester: b.requester?.full_name || '-',
              borrow_date: formatThaiDate(b.borrow_date),
              expected_return: formatThaiDate(b.expected_return_date),
              status: BORROW_STATUS_META[b.status as keyof typeof BORROW_STATUS_META]?.label || b.status,
            })),
        };

      case 'transfers':
        return {
          columns: [
            { key: 'seq', header: 'ลำดับ' },
            { key: 'transfer_no', header: 'เลขที่ใบโอน' },
            { key: 'asset_code', header: 'เลขครุภัณฑ์' },
            { key: 'from_dept', header: 'หน่วยงานเดิม' },
            { key: 'to_dept', header: 'หน่วยงานใหม่' },
            { key: 'effective_date', header: 'วันที่มีผล' },
            { key: 'reason', header: 'เหตุผล' },
            { key: 'status', header: 'สถานะ' },
          ],
          rows: rawData.transfers.map((t, idx) => ({
            seq: idx + 1,
            transfer_no: t.transfer_no,
            asset_code: t.asset?.asset_code || '-',
            from_dept: t.from_department?.name || '-',
            to_dept: t.to_department?.name || '-',
            effective_date: formatThaiDate(t.effective_date),
            reason: t.reason,
            status: TRANSFER_STATUS_META[t.status as keyof typeof TRANSFER_STATUS_META]?.label || t.status,
          })),
        };

      case 'maintenance_cost':
        return {
          columns: [
            { key: 'seq', header: 'ลำดับ' },
            { key: 'ticket_no', header: 'เลขที่ใบแจ้งซ่อม' },
            { key: 'asset_code', header: 'เลขครุภัณฑ์' },
            { key: 'issue', header: 'อาการเสีย' },
            { key: 'vendor', header: 'ผู้ให้บริการซ่อม' },
            { key: 'reported_date', header: 'วันที่แจ้ง' },
            { key: 'actual_cost', header: 'ค่าซ่อมจริง (บาท)' },
            { key: 'status', header: 'สถานะ' },
          ],
          rows: rawData.maintenances.map((m, idx) => ({
            seq: idx + 1,
            ticket_no: m.ticket_no,
            asset_code: m.asset?.asset_code || '-',
            issue: m.issue_description,
            vendor: m.vendor_name || '-',
            reported_date: formatThaiDate(m.reported_date),
            actual_cost: formatCurrency(m.actual_cost),
            status:
              MAINTENANCE_STATUS_META[m.status as keyof typeof MAINTENANCE_STATUS_META]?.label ||
              m.status,
          })),
        };

      case 'disposal':
        return {
          columns: [
            { key: 'seq', header: 'ลำดับ' },
            { key: 'disposal_no', header: 'เลขที่คำขอจำหน่าย' },
            { key: 'asset_code', header: 'เลขครุภัณฑ์' },
            { key: 'asset_name', header: 'ชื่อครุภัณฑ์' },
            { key: 'reason', header: 'สาเหตุการจำหน่าย' },
            { key: 'document_no', header: 'เลขที่หนังสืออนุมัติ' },
            { key: 'salvage_value', header: 'มูลค่าซาก (บาท)' },
            { key: 'status', header: 'สถานะ' },
          ],
          rows: rawData.disposals.map((d, idx) => ({
            seq: idx + 1,
            disposal_no: d.disposal_no,
            asset_code: d.asset?.asset_code || '-',
            asset_name: d.asset?.name || '-',
            reason: DISPOSAL_REASON_LABELS[d.reason_type] || d.reason_type,
            document_no: d.document_no || '-',
            salvage_value: formatCurrency(d.salvage_value),
            status: DISPOSAL_STATUS_META[d.status as keyof typeof DISPOSAL_STATUS_META]?.label || d.status,
          })),
        };

      case 'audit_trail':
        return {
          columns: [
            { key: 'seq', header: 'ลำดับ' },
            { key: 'created_at', header: 'วันเวลา' },
            { key: 'actor', header: 'ผู้ดำเนินการ' },
            { key: 'role', header: 'บทบาท' },
            { key: 'action', header: 'ประเภทคำสั่ง' },
            { key: 'entity', header: 'ตารางข้อมูล' },
            { key: 'summary', header: 'รายละเอียดการดำเนินการ' },
          ],
          rows: rawData.audits.map((log, idx) => ({
            seq: idx + 1,
            created_at: formatThaiDateTime(log.created_at),
            actor: log.actor_email || 'ระบบ',
            role: log.actor_role || '-',
            action: log.action,
            entity: log.entity_type,
            summary: log.summary,
          })),
        };
    }
  }, [rawData, selectedReport, deptFilter, categoryFilter, statusFilter]);

  const currentReportMeta = REPORT_TYPES.find((r) => r.key === selectedReport)!;

  const handleExport = (format: 'xlsx' | 'pdf') => {
    if (reportTable.rows.length === 0) {
      toast.error('ไม่มีข้อมูลในรายงานนี้สำหรับส่งออก');
      return;
    }

    const meta = {
      reportTitle: currentReportMeta.title,
      orgName: settings?.org_name,
      filtersSummary: `จำนวน ${reportTable.rows.length} รายการ`,
      fileNamePrefix: `report_${selectedReport}`,
    };

    if (format === 'xlsx') {
      exportToExcel(reportTable.rows, reportTable.columns, meta);
      toast.success('ส่งออกรายงาน Excel (.xlsx) สำเร็จ');
    } else {
      exportToPDF(reportTable.rows, reportTable.columns, meta);
      toast.success('ส่งออกรายงาน PDF สำเร็จ');
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="รายงานและส่งออกข้อมูลพัสดุ (Official Reports & Export)"
        subtitle="ออกรายงานมาตรฐานราชการทั้ง 9 ประเภท พร้อมส่งออกเป็นไฟล์ Excel (.xlsx) และ PDF จากฐานข้อมูลจริง"
        actions={
          <>
            <button
              type="button"
              onClick={() => handleExport('xlsx')}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
            >
              <FileSpreadsheet className="h-4 w-4" />
              ส่งออก Excel (.xlsx)
            </button>
            <button
              type="button"
              onClick={() => handleExport('pdf')}
              className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-rose-700"
            >
              <FileText className="h-4 w-4" />
              ส่งออก PDF
            </button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
        {/* เมนูเลือกรายงานทั้ง 9 ประเภท */}
        <div className="space-y-2">
          {REPORT_TYPES.map((rep) => (
            <button
              key={rep.key}
              type="button"
              onClick={() => setSelectedReport(rep.key)}
              className={`w-full rounded-xl border p-3.5 text-left transition ${
                selectedReport === rep.key
                  ? 'border-gov-700 bg-gov-50/90 text-gov-900 shadow-2xs'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              <p className="text-xs font-bold">{rep.title}</p>
              <p className="mt-1 text-[11px] text-slate-500 line-clamp-2">{rep.description}</p>
            </button>
          ))}
        </div>

        {/* ตัวอย่างข้อมูลรายงาน */}
        <div className="lg:col-span-3 space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs space-y-3">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2.5">
                <FileBarChart2 className="h-5 w-5 text-gov-700" />
                <div>
                  <h2 className="text-base font-bold text-slate-900">{currentReportMeta.title}</h2>
                  <p className="text-xs text-slate-500">{currentReportMeta.description}</p>
                </div>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                ทั้งหมด {reportTable.rows.length} รายการ
              </span>
            </div>

            {['all_assets', 'by_category_dept', 'valuation'].includes(selectedReport) && (
              <div className="grid grid-cols-1 gap-3 pt-2 border-t border-slate-100 sm:grid-cols-3">
                <select
                  value={deptFilter}
                  onChange={(e) => setDeptFilter(e.target.value)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs"
                >
                  <option value="">ทุกหน่วยงาน</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.code} - {d.name}
                    </option>
                  ))}
                </select>
                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs"
                >
                  <option value="">ทุกหมวดหมู่</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} - {c.name}
                    </option>
                  ))}
                </select>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs"
                >
                  <option value="">ทุกสถานะ</option>
                  {Object.entries(ASSET_STATUS_META).map(([key, meta]) => (
                    <option key={key} value={key}>
                      {meta.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {isLoading ? (
            <LoadingState message="กำลังจัดเตรียมข้อมูลรายงาน..." />
          ) : error ? (
            <ErrorState message={translateSupabaseError(error)} onRetry={() => refetch()} />
          ) : (
            <div className="rounded-xl border border-slate-200 bg-white shadow-2xs overflow-hidden">
              <div className="overflow-x-auto max-h-[600px]">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 font-semibold text-slate-600 border-b border-slate-200 sticky top-0">
                    <tr>
                      {reportTable.columns.map((col) => (
                        <th key={col.key} className="p-3 whitespace-nowrap">
                          {col.header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {reportTable.rows.length === 0 ? (
                      <tr>
                        <td
                          colSpan={reportTable.columns.length || 1}
                          className="p-10 text-center text-slate-400"
                        >
                          ไม่มีข้อมูลสำหรับรายงานนี้
                        </td>
                      </tr>
                    ) : (
                      reportTable.rows.map((row, idx) => (
                        <tr key={idx} className="hover:bg-slate-50">
                          {reportTable.columns.map((col) => (
                            <td key={col.key} className="p-3">
                              {String(row[col.key] ?? '-')}
                            </td>
                          ))}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
