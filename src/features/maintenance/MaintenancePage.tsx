import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import {
  Plus,
  Wrench,
  Edit3,
  ExternalLink,
  Loader2,
  Search,
} from 'lucide-react';
import { assertSupabaseConfigured, isSupabaseConfigured, recordAuditLog, supabase } from '@/lib/supabase';
import {
  formatCurrency,
  MAINTENANCE_STATUS_META,
  translateSupabaseError,
  URGENCY_META,
} from '@/lib/utils';
import { formatThaiDate, toISODateInput } from '@/lib/date';
import { getSignedFileUrl, uploadFileToBucket } from '@/lib/storage';
import { useAuth } from '@/features/auth/AuthContext';
import { useProfiles } from '@/hooks/useMasterData';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  Modal,
  PageHeader,
  StatusBadge,
} from '@/components/ui/common';
import type { Asset, MaintenanceRequest, MaintenanceStatus } from '@/types/database';

const createTicketSchema = z.object({
  asset_id: z.string().min(1, 'กรุณาเลือกครุภัณฑ์ที่ชำรุดหรือต้องการบำรุงรักษา'),
  reported_date: z.string().min(1, 'กรุณาระบุวันที่แจ้งซ่อม'),
  urgency: z.enum(['low', 'medium', 'high', 'critical']),
  issue_description: z.string().min(4, 'กรุณาระบุอาการเสียหรือรายละเอียดการแจ้งซ่อม'),
  estimated_cost: z.coerce.number().min(0).optional(),
});

type CreateTicketValues = z.infer<typeof createTicketSchema>;

export function MaintenancePage() {
  const { user, hasRole } = useAuth();
  const canManage = hasRole(['admin', 'asset_officer']);
  const queryClient = useQueryClient();
  const configured = isSupabaseConfigured();

  const { data: profiles = [] } = useProfiles();

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null);

  // Update Status & Cost Modal
  const [editingTicket, setEditingTicket] = useState<MaintenanceRequest | null>(null);
  const [newStatus, setNewStatus] = useState<MaintenanceStatus>('in_progress');
  const [assignedTo, setAssignedTo] = useState('');
  const [vendorName, setVendorName] = useState('');
  const [actualCost, setActualCost] = useState(0);
  const [sentDate, setSentDate] = useState('');
  const [completedDate, setCompletedDate] = useState('');
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);

  const {
    data: tickets = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['maintenance-requests'],
    queryFn: async () => {
      if (!configured) return [] as MaintenanceRequest[];
      const { data, error: fetchErr } = await supabase
        .from('maintenance_requests')
        .select(
          '*, asset:assets(*), reporter:profiles!maintenance_requests_reported_by_fkey(*), assignee:profiles!maintenance_requests_assigned_to_fkey(*)'
        )
        .order('created_at', { ascending: false });
      if (fetchErr) throw fetchErr;
      return (data || []) as MaintenanceRequest[];
    },
  });

  const { data: assets = [] } = useQuery({
    queryKey: ['assets-list'],
    queryFn: async () => {
      if (!configured) return [] as Asset[];
      const { data, error: err } = await supabase
        .from('assets')
        .select('*')
        .eq('is_archived', false)
        .neq('status', 'disposed')
        .order('asset_code', { ascending: true });
      if (err) throw err;
      return (data || []) as Asset[];
    },
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateTicketValues>({
    resolver: zodResolver(createTicketSchema),
    defaultValues: {
      asset_id: '',
      reported_date: toISODateInput(),
      urgency: 'medium',
      issue_description: '',
      estimated_cost: 0,
    },
  });

  const onCreateTicket = async (values: CreateTicketValues) => {
    try {
      assertSupabaseConfigured();
      if (!user) {
        toast.error('กรุณาเข้าสู่ระบบก่อนแจ้งซ่อม');
        return;
      }

      const targetAsset = assets.find((a) => a.id === values.asset_id);
      const ticketNo = `MNT-${new Date().getFullYear() + 543}-${String(Date.now()).slice(-5)}`;

      let uploadedPath: string | null = null;
      if (attachmentFile) {
        const up = await uploadFileToBucket({
          bucket: 'maintenance-attachments',
          folder: ticketNo,
          file: attachmentFile,
        });
        uploadedPath = up.path;
      }

      const { data: created, error: insertErr } = await supabase
        .from('maintenance_requests')
        .insert({
          ticket_no: ticketNo,
          asset_id: values.asset_id,
          reported_by: user.id,
          reported_date: values.reported_date,
          urgency: values.urgency,
          issue_description: values.issue_description.trim(),
          estimated_cost: Number(values.estimated_cost || 0),
          status: 'pending',
          attachment_path: uploadedPath,
        })
        .select('id')
        .single();

      if (insertErr) throw insertErr;

      await recordAuditLog({
        action: 'MAINTENANCE_CREATED',
        entityType: 'maintenance_requests',
        entityId: created.id,
        summary: `สร้างใบแจ้งซ่อม ${ticketNo} สำหรับครุภัณฑ์ ${targetAsset?.asset_code || ''}`,
      });

      toast.success(`บันทึกใบแจ้งซ่อมเลขที่ ${ticketNo} สำเร็จ`);
      setIsCreateOpen(false);
      setAttachmentFile(null);
      reset();
      queryClient.invalidateQueries({ queryKey: ['maintenance-requests'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
    } catch (err) {
      toast.error(translateSupabaseError(err));
    }
  };

  const openManageModal = (ticket: MaintenanceRequest) => {
    setEditingTicket(ticket);
    setNewStatus(ticket.status);
    setAssignedTo(ticket.assigned_to || '');
    setVendorName(ticket.vendor_name || '');
    setActualCost(Number(ticket.actual_cost || 0));
    setSentDate(ticket.sent_date || toISODateInput());
    setCompletedDate(ticket.completed_date || '');
    setResolutionNotes(ticket.resolution_notes || '');
  };

  const handleSaveMaintenanceUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTicket) return;

    setIsUpdating(true);
    try {
      assertSupabaseConfigured();

      const { error: updateErr } = await supabase
        .from('maintenance_requests')
        .update({
          status: newStatus,
          assigned_to: assignedTo || null,
          vendor_name: vendorName.trim() || null,
          actual_cost: Number(actualCost || 0),
          sent_date: sentDate || null,
          completed_date:
            newStatus === 'completed' ? completedDate || toISODateInput() : completedDate || null,
          resolution_notes: resolutionNotes.trim() || null,
        })
        .eq('id', editingTicket.id);

      if (updateErr) throw updateErr;

      // บันทึกประวัติการซ่อมลงตาราง maintenance_logs
      await supabase.from('maintenance_logs').insert({
        maintenance_request_id: editingTicket.id,
        asset_id: editingTicket.asset_id,
        status_from: editingTicket.status,
        status_to: newStatus,
        cost: Number(actualCost || 0),
        vendor_name: vendorName.trim() || null,
        description: resolutionNotes.trim() || `ปรับสถานะเป็น ${MAINTENANCE_STATUS_META[newStatus].label}`,
        performed_by: user?.id || null,
      });

      // ปรับสถานะครุภัณฑ์ในตาราง assets ให้สอดคล้องกัน
      let nextAssetStatus: string | null = null;
      if (['approved', 'in_progress', 'waiting_parts'].includes(newStatus)) {
        nextAssetStatus = 'under_maintenance';
      } else if (newStatus === 'completed') {
        nextAssetStatus = 'available';
      } else if (newStatus === 'unrepairable') {
        nextAssetStatus = 'pending_disposal';
      }

      if (nextAssetStatus) {
        await supabase
          .from('assets')
          .update({ status: nextAssetStatus, updated_by: user?.id || null })
          .eq('id', editingTicket.asset_id);
      }

      await recordAuditLog({
        action: 'MAINTENANCE_UPDATED',
        entityType: 'maintenance_requests',
        entityId: editingTicket.id,
        summary: `อัปเดตใบแจ้งซ่อม ${editingTicket.ticket_no} เป็น "${MAINTENANCE_STATUS_META[newStatus].label}" (ค่าใช้จ่าย ${formatCurrency(actualCost)})`,
      });

      toast.success('บันทึกผลการดำเนินงานซ่อมและค่าใช้จ่ายสำเร็จ');
      setEditingTicket(null);
      queryClient.invalidateQueries({ queryKey: ['maintenance-requests'] });
      queryClient.invalidateQueries({ queryKey: ['assets-list'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
    } catch (err) {
      toast.error(translateSupabaseError(err));
    } finally {
      setIsUpdating(false);
    }
  };

  const handleViewAttachment = async (path: string) => {
    try {
      const signed = await getSignedFileUrl('maintenance-attachments', path, 300);
      window.open(signed, '_blank', 'noopener,noreferrer');
    } catch (err) {
      toast.error(translateSupabaseError(err));
    }
  };

  const totalCostSum = useMemo(() => {
    return tickets.reduce((sum, t) => sum + Number(t.actual_cost || 0), 0);
  }, [tickets]);

  const filteredTickets = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return tickets.filter((t) => {
      if (statusFilter && t.status !== statusFilter) return false;
      if (!q) return true;
      return (
        t.ticket_no.toLowerCase().includes(q) ||
        (t.asset?.asset_code || '').toLowerCase().includes(q) ||
        (t.asset?.name || '').toLowerCase().includes(q) ||
        t.issue_description.toLowerCase().includes(q) ||
        (t.vendor_name || '').toLowerCase().includes(q)
      );
    });
  }, [tickets, searchTerm, statusFilter]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="แจ้งซ่อมและบำรุงรักษาครุภัณฑ์ (Maintenance & Repair)"
        subtitle="สร้างใบแจ้งซ่อม ติดตามสถานะการซ่อม บันทึกผู้ให้บริการ ค่าใช้จ่ายสะสม และประวัติการซ่อมรายครุภัณฑ์"
        actions={
          <button
            type="button"
            onClick={() => setIsCreateOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-gov-700 px-4 py-2 text-xs font-semibold text-white hover:bg-gov-800"
          >
            <Plus className="h-4 w-4" />
            สร้างใบแจ้งซ่อมใหม่
          </button>
        }
      />

      {/* สรุปภาพรวมการซ่อมและค่าใช้จ่ายสะสม */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500">ใบแจ้งซ่อมทั้งหมด</p>
          <p className="mt-1 text-xl font-bold text-slate-900">{tickets.length} รายการ</p>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4">
          <p className="text-xs text-amber-800">กำลังดำเนินการ / รออะไหล่</p>
          <p className="mt-1 text-xl font-bold text-amber-700">
            {tickets.filter((t) => ['pending', 'approved', 'in_progress', 'waiting_parts'].includes(t.status)).length} รายการ
          </p>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4">
          <p className="text-xs text-emerald-800">ซ่อมเสร็จสิ้นแล้ว</p>
          <p className="mt-1 text-xl font-bold text-emerald-700">
            {tickets.filter((t) => t.status === 'completed').length} รายการ
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500">ค่าใช้จ่ายในการซ่อมสะสมรวม</p>
          <p className="mt-1 text-xl font-bold text-gov-700">{formatCurrency(totalCostSum)}</p>
        </div>
      </div>

      {/* ค้นหาและตัวกรอง */}
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-2xs sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="ค้นหาเลขที่ใบแจ้งซ่อม, เลขครุภัณฑ์, อาการเสีย, ร้าน/บริษัทซ่อม..."
            className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
        >
          <option value="">ทุกสถานะการซ่อม</option>
          {Object.entries(MAINTENANCE_STATUS_META).map(([key, meta]) => (
            <option key={key} value={key}>
              {meta.label}
            </option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <LoadingState message="กำลังโหลดรายการแจ้งซ่อม..." />
      ) : error ? (
        <ErrorState message={translateSupabaseError(error)} onRetry={() => refetch()} />
      ) : filteredTickets.length === 0 ? (
        <EmptyState
          title="ไม่พบรายการใบแจ้งซ่อม"
          description="ยังไม่มีการแจ้งซ่อมครุภัณฑ์ในระบบ หรือไม่ตรงกับเงื่อนไขการค้นหา"
        />
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white shadow-2xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs font-semibold text-slate-600 border-b border-slate-200">
                <tr>
                  <th className="p-3.5">เลขที่ใบแจ้งซ่อม</th>
                  <th className="p-3.5">ครุภัณฑ์</th>
                  <th className="p-3.5">อาการชำรุด / ผู้แจ้ง</th>
                  <th className="p-3.5">ความเร่งด่วน</th>
                  <th className="p-3.5">ผู้ให้บริการ / การแก้ไข</th>
                  <th className="p-3.5 text-right">ค่าใช้จ่ายจริง</th>
                  <th className="p-3.5">สถานะ</th>
                  <th className="p-3.5 text-right">จัดการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {filteredTickets.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50">
                    <td className="p-3.5 font-mono font-bold text-gov-700 whitespace-nowrap">
                      {t.ticket_no}
                      <p className="text-[11px] font-normal text-slate-400">
                        {formatThaiDate(t.reported_date)}
                      </p>
                    </td>
                    <td className="p-3.5">
                      <p className="font-mono font-semibold text-slate-900">
                        {t.asset?.asset_code || '-'}
                      </p>
                      <p className="text-slate-600">{t.asset?.name || '-'}</p>
                    </td>
                    <td className="p-3.5 max-w-xs">
                      <p className="font-medium text-slate-900">{t.issue_description}</p>
                      <p className="text-slate-500 mt-0.5">ผู้แจ้ง: {t.reporter?.full_name || '-'}</p>
                    </td>
                    <td className="p-3.5">
                      <StatusBadge
                        label={URGENCY_META[t.urgency]?.label || t.urgency}
                        className={URGENCY_META[t.urgency]?.badgeClass}
                      />
                    </td>
                    <td className="p-3.5">
                      <p className="font-medium text-slate-800">{t.vendor_name || 'ยังไม่ระบุร้าน/ผู้รับจ้าง'}</p>
                      {t.resolution_notes && (
                        <p className="text-slate-500 mt-0.5">{t.resolution_notes}</p>
                      )}
                    </td>
                    <td className="p-3.5 text-right font-semibold text-slate-900 whitespace-nowrap">
                      {formatCurrency(t.actual_cost)}
                    </td>
                    <td className="p-3.5">
                      <StatusBadge
                        label={MAINTENANCE_STATUS_META[t.status]?.label || t.status}
                        className={MAINTENANCE_STATUS_META[t.status]?.badgeClass}
                      />
                    </td>
                    <td className="p-3.5 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5">
                        {t.attachment_path && (
                          <button
                            type="button"
                            onClick={() => handleViewAttachment(t.attachment_path!)}
                            className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100"
                            title="ดูไฟล์แนบใบแจ้งซ่อม"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </button>
                        )}
                        {canManage && (
                          <button
                            type="button"
                            onClick={() => openManageModal(t)}
                            className="inline-flex items-center gap-1 rounded-lg bg-gov-700 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-gov-800"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                            อัปเดตสถานะ/ค่าซ่อม
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal สร้างใบแจ้งซ่อม */}
      <Modal
        open={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        title="สร้างใบแจ้งซ่อมและบำรุงรักษาครุภัณฑ์"
        description="ระบุครุภัณฑ์ที่ชำรุด อาการเสีย และแนบรูปภาพหรือเอกสารประกอบ"
      >
        <form onSubmit={handleSubmit(onCreateTicket)} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700">
              เลือกครุภัณฑ์ที่ต้องการแจ้งซ่อม <span className="text-rose-600">*</span>
            </label>
            <select
              {...register('asset_id')}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              <option value="">-- เลือกครุภัณฑ์ --</option>
              {assets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.asset_code} — {a.name}
                </option>
              ))}
            </select>
            {errors.asset_id && <p className="mt-1 text-xs text-rose-600">{errors.asset_id.message}</p>}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700">วันที่แจ้งซ่อม</label>
              <input
                type="date"
                {...register('reported_date')}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">ระดับความเร่งด่วน</label>
              <select
                {...register('urgency')}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                {Object.entries(URGENCY_META).map(([key, meta]) => (
                  <option key={key} value={key}>
                    {meta.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">
                ประมาณการค่าซ่อมเบื้องต้น (บาท)
              </label>
              <input
                type="number"
                step="0.01"
                {...register('estimated_cost')}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700">
              อาการชำรุด / รายละเอียดปัญหาที่พบ <span className="text-rose-600">*</span>
            </label>
            <textarea
              rows={3}
              placeholder="อธิบายอาการเสียที่พบโดยละเอียด..."
              {...register('issue_description')}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
            {errors.issue_description && (
              <p className="mt-1 text-xs text-rose-600">{errors.issue_description.message}</p>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700">
              แนบรูปภาพความเสียหาย หรือใบเสนอราคาซ่อม (PDF, JPG, PNG, WEBP)
            </label>
            <input
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp"
              onChange={(e) => setAttachmentFile(e.target.files?.[0] || null)}
              className="mt-1.5 block w-full text-xs text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-gov-700 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white"
            />
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
            <button
              type="button"
              onClick={() => setIsCreateOpen(false)}
              className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex items-center gap-2 rounded-lg bg-gov-700 px-4 py-2 text-xs font-semibold text-white hover:bg-gov-800"
            >
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              บันทึกใบแจ้งซ่อม
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal อัปเดตสถานะซ่อมและบันทึกค่าใช้จ่าย */}
      <Modal
        open={Boolean(editingTicket)}
        onClose={() => setEditingTicket(null)}
        title={`บันทึกผลการซ่อมและค่าใช้จ่าย: ${editingTicket?.ticket_no || ''}`}
        description="เฉพาะเจ้าหน้าที่พัสดุหรือผู้ดูแลระบบเท่านั้นที่มีสิทธิ์แก้ไขสถานะและค่าใช้จ่าย"
      >
        {editingTicket && (
          <form onSubmit={handleSaveMaintenanceUpdate} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-semibold text-slate-700">สถานะการซ่อมบำรุง</label>
                <select
                  value={newStatus}
                  onChange={(e) => setNewStatus(e.target.value as MaintenanceStatus)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold"
                >
                  {Object.entries(MAINTENANCE_STATUS_META).map(([key, meta]) => (
                    <option key={key} value={key}>
                      {meta.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">เจ้าหน้าที่ผู้รับผิดชอบติดตามงานซ่อม</label>
                <select
                  value={assignedTo}
                  onChange={(e) => setAssignedTo(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="">-- ไม่ระบุ --</option>
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.full_name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">บริษัท / ร้านค้าผู้ให้บริการซ่อม</label>
                <input
                  type="text"
                  value={vendorName}
                  onChange={(e) => setVendorName(e.target.value)}
                  placeholder="ระบุชื่อบริษัทซ่อมบำรุง..."
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">ค่าใช้จ่ายในการซ่อมจริง (บาท)</label>
                <input
                  type="number"
                  step="0.01"
                  value={actualCost}
                  onChange={(e) => setActualCost(Number(e.target.value))}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">วันที่ส่งซ่อม</label>
                <input
                  type="date"
                  value={sentDate}
                  onChange={(e) => setSentDate(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">วันที่รับคืน / ซ่อมเสร็จ</label>
                <input
                  type="date"
                  value={completedDate}
                  onChange={(e) => setCompletedDate(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">รายละเอียดการซ่อม / อะไหล่ที่เปลี่ยน</label>
              <textarea
                rows={3}
                value={resolutionNotes}
                onChange={(e) => setResolutionNotes(e.target.value)}
                placeholder="บันทึกรายละเอียดการดำเนินการซ่อม..."
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setEditingTicket(null)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700"
              >
                ยกเลิก
              </button>
              <button
                type="submit"
                disabled={isUpdating}
                className="inline-flex items-center gap-2 rounded-lg bg-gov-700 px-4 py-2 text-xs font-semibold text-white hover:bg-gov-800"
              >
                {isUpdating && <Loader2 className="h-4 w-4 animate-spin" />}
                บันทึกผลการซ่อมและประวัติ
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
