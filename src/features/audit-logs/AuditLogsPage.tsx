import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, ShieldCheck, Eye } from 'lucide-react';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { translateSupabaseError } from '@/lib/utils';
import { formatThaiDateTime } from '@/lib/date';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  Modal,
  PageHeader,
  PaginationControls,
} from '@/components/ui/common';
import type { AuditLog } from '@/types/database';

export function AuditLogsPage() {
  const configured = isSupabaseConfigured();

  const [searchTerm, setSearchTerm] = useState('');
  const [entityFilter, setEntityFilter] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);

  const {
    data: logs = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['audit-logs-list'],
    queryFn: async () => {
      if (!configured) return [] as AuditLog[];
      const { data, error: fetchErr } = await supabase
        .from('audit_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500);
      if (fetchErr) throw fetchErr;
      return (data || []) as AuditLog[];
    },
  });

  const filteredLogs = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return logs.filter((log) => {
      if (entityFilter && log.entity_type !== entityFilter) return false;
      if (!q) return true;
      return (
        log.action.toLowerCase().includes(q) ||
        log.summary.toLowerCase().includes(q) ||
        (log.actor_email || '').toLowerCase().includes(q) ||
        (log.entity_id || '').toLowerCase().includes(q)
      );
    });
  }, [logs, searchTerm, entityFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredLogs.length / pageSize));
  const paginatedLogs = filteredLogs.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="ประวัติการใช้งานและการดำเนินการสำคัญ (Immutable Audit Log)"
        subtitle="บันทึกทุกการเปลี่ยนแปลงข้อมูลสำคัญ การอนุมัติ และการเปลี่ยนสิทธิ์ โดยไม่อนุญาตให้แก้ไขหรือลบผ่านระบบ Client"
        actions={
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">
            <ShieldCheck className="h-4 w-4 text-emerald-600" />
            ป้องกันการลบ/แก้ไขด้วย RLS
          </span>
        }
      />

      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-2xs sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setCurrentPage(1);
            }}
            placeholder="ค้นหาผู้ดำเนินการ, ประเภทคำสั่ง (Action), รายละเอียด..."
            className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm"
          />
        </div>
        <select
          value={entityFilter}
          onChange={(e) => {
            setEntityFilter(e.target.value);
            setCurrentPage(1);
          }}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
        >
          <option value="">ทุกประเภทข้อมูล (Entity Type)</option>
          <option value="assets">ทะเบียนครุภัณฑ์ (assets)</option>
          <option value="borrow_requests">การยืม-คืน (borrow_requests)</option>
          <option value="asset_transfers">การโอนย้าย (asset_transfers)</option>
          <option value="maintenance_requests">การแจ้งซ่อม (maintenance_requests)</option>
          <option value="disposal_requests">การแทงจำหน่าย (disposal_requests)</option>
          <option value="inventory_sessions">รอบตรวจนับ (inventory_sessions)</option>
          <option value="inventory_items">ผลตรวจนับ (inventory_items)</option>
          <option value="profiles">สิทธิ์ผู้ใช้งาน (profiles)</option>
          <option value="system_settings">ตั้งค่าระบบ (system_settings)</option>
          <option value="auth">การเข้า-ออกจากระบบ (auth)</option>
        </select>
      </div>

      {isLoading ? (
        <LoadingState message="กำลังโหลดบันทึก Audit Log..." />
      ) : error ? (
        <ErrorState message={translateSupabaseError(error)} onRetry={() => refetch()} />
      ) : filteredLogs.length === 0 ? (
        <EmptyState
          title="ไม่พบบันทึกประวัติการดำเนินการ"
          description="เมื่อมีการเพิ่ม/แก้ไขครุภัณฑ์ อนุมัติคำขอ หรือเปลี่ยนสิทธิ์ ข้อมูลจะปรากฏที่นี่โดยอัตโนมัติ"
        />
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white shadow-2xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs font-semibold text-slate-600 border-b border-slate-200">
                <tr>
                  <th className="p-3.5">วันและเวลา</th>
                  <th className="p-3.5">ผู้ดำเนินการ (Actor)</th>
                  <th className="p-3.5">คำสั่ง (Action)</th>
                  <th className="p-3.5">โมดูล (Entity)</th>
                  <th className="p-3.5">สรุปรายละเอียด</th>
                  <th className="p-3.5 text-right">ข้อมูลก่อน/หลัง</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {paginatedLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50">
                    <td className="p-3.5 whitespace-nowrap text-slate-600">
                      {formatThaiDateTime(log.created_at)}
                    </td>
                    <td className="p-3.5">
                      <p className="font-semibold text-slate-900">{log.actor_email || 'ระบบ'}</p>
                      <p className="text-[11px] text-slate-500">บทบาท: {log.actor_role || '-'}</p>
                    </td>
                    <td className="p-3.5 font-mono font-bold text-gov-700 whitespace-nowrap">
                      {log.action}
                    </td>
                    <td className="p-3.5 font-mono text-slate-600">{log.entity_type}</td>
                    <td className="p-3.5 text-slate-800">{log.summary}</td>
                    <td className="p-3.5 text-right">
                      {(log.before_data || log.after_data) && (
                        <button
                          type="button"
                          onClick={() => setSelectedLog(log)}
                          className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          ดู JSON
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <PaginationControls
            currentPage={currentPage}
            totalPages={totalPages}
            totalItems={filteredLogs.length}
            pageSize={pageSize}
            onPageChange={setCurrentPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setCurrentPage(1);
            }}
          />
        </div>
      )}

      <Modal
        open={Boolean(selectedLog)}
        onClose={() => setSelectedLog(null)}
        title={`รายละเอียด Audit Log: ${selectedLog?.action || ''}`}
        description={selectedLog?.summary}
      >
        {selectedLog && (
          <div className="space-y-4 text-xs">
            <div>
              <p className="font-semibold text-slate-700 mb-1">ข้อมูลก่อนการเปลี่ยนแปลง (Before Data):</p>
              <pre className="overflow-x-auto rounded-lg bg-slate-900 p-3 text-slate-100 font-mono">
                {JSON.stringify(selectedLog.before_data || {}, null, 2)}
              </pre>
            </div>
            <div>
              <p className="font-semibold text-slate-700 mb-1">ข้อมูลหลังการเปลี่ยนแปลง (After Data):</p>
              <pre className="overflow-x-auto rounded-lg bg-slate-900 p-3 text-slate-100 font-mono">
                {JSON.stringify(selectedLog.after_data || {}, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
