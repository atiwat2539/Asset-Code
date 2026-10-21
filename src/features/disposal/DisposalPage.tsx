import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import {
  Plus,
  ShieldAlert,
  ExternalLink,
  Loader2,
  Search,
  Edit3,
} from 'lucide-react';
import { assertSupabaseConfigured, isSupabaseConfigured, recordAuditLog, supabase } from '@/lib/supabase';
import {
  DISPOSAL_REASON_LABELS,
  DISPOSAL_STATUS_META,
  formatCurrency,
  translateSupabaseError,
} from '@/lib/utils';
import { formatThaiDate, toISODateInput } from '@/lib/date';
import { getSignedFileUrl, uploadFileToBucket } from '@/lib/storage';
import { useAuth } from '@/features/auth/AuthContext';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  Modal,
  PageHeader,
  StatusBadge,
} from '@/components/ui/common';
import type { Asset, DisposalRequest, DisposalStatus } from '@/types/database';

const disposalSchema = z.object({
  asset_id: z.string().min(1, 'กรุณาเลือกครุภัณฑ์ที่เสนอขอจำหน่าย'),
  reason_type: z.enum(['deteriorated', 'damaged_beyond_repair', 'obsolete', 'lost', 'other']),
  reason_detail: z.string().min(5, 'กรุณาระบุเหตุผลและความจำเป็นในการขอจำหน่ายโดยละเอียด'),
  proposed_date: z.string().min(1, 'กรุณาระบุวันที่เสนอคำขอ'),
  document_no: z.string().optional(),
  initial_status: z.enum(['draft', 'submitted']),
  notes: z.string().optional(),
});

type DisposalFormValues = z.infer<typeof disposalSchema>;

export function DisposalPage() {
  const { user, hasRole } = useAuth();
  const isAdmin = hasRole(['admin']);
  const canPropose = hasRole(['admin', 'asset_officer']);
  const queryClient = useQueryClient();
  const configured = isSupabaseConfigured();

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null);

  // Workflow update state
  const [activeRequest, setActiveRequest] = useState<DisposalRequest | null>(null);
  const [targetStatus, setTargetStatus] = useState<DisposalStatus>('under_review');
  const [docNo, setDocNo] = useState('');
  const [disposalMethod, setDisposalMethod] = useState<'sale' | 'transfer_out' | 'destroy' | 'write_off'>('write_off');
  const [salvageValue, setSalvageValue] = useState(0);
  const [workflowNotes, setWorkflowNotes] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  const {
    data: requests = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['disposal-requests'],
    queryFn: async () => {
      if (!configured) return [] as DisposalRequest[];
      const { data, error: fetchErr } = await supabase
        .from('disposal_requests')
        .select(
          '*, asset:assets(*), proposer:profiles!disposal_requests_proposed_by_fkey(*), approver:profiles!disposal_requests_approved_by_fkey(*)'
        )
        .order('created_at', { ascending: false });
      if (fetchErr) throw fetchErr;
      return (data || []) as DisposalRequest[];
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
  } = useForm<DisposalFormValues>({
    resolver: zodResolver(disposalSchema),
    defaultValues: {
      asset_id: '',
      reason_type: 'deteriorated',
      reason_detail: '',
      proposed_date: toISODateInput(),
      document_no: '',
      initial_status: 'submitted',
      notes: '',
    },
  });

  const onCreateDisposalRequest = async (values: DisposalFormValues) => {
    try {
      assertSupabaseConfigured();
      if (!user) return;

      const targetAsset = assets.find((a) => a.id === values.asset_id);
      const disposalNo = `DSP-${new Date().getFullYear() + 543}-${String(Date.now()).slice(-5)}`;

      let uploadedPath: string | null = null;
      if (attachmentFile) {
        const up = await uploadFileToBucket({
          bucket: 'disposal-attachments',
          folder: disposalNo,
          file: attachmentFile,
        });
        uploadedPath = up.path;
      }

      const { data: created, error: insertErr } = await supabase
        .from('disposal_requests')
        .insert({
          disposal_no: disposalNo,
          asset_id: values.asset_id,
          reason_type: values.reason_type,
          reason_detail: values.reason_detail.trim(),
          proposed_by: user.id,
          proposed_date: values.proposed_date,
          status: values.initial_status,
          document_no: values.document_no?.trim() || null,
          attachment_path: uploadedPath,
          notes: values.notes?.trim() || null,
        })
        .select('id')
        .single();

      if (insertErr) throw insertErr;

      if (values.initial_status === 'submitted') {
        await supabase
          .from('assets')
          .update({ status: 'pending_disposal', updated_by: user.id })
          .eq('id', values.asset_id);
      }

      await recordAuditLog({
        action: 'DISPOSAL_REQUEST_CREATED',
        entityType: 'disposal_requests',
        entityId: created.id,
        summary: `สร้างคำขอจำหน่ายเลขที่ ${disposalNo} สำหรับครุภัณฑ์ ${targetAsset?.asset_code || ''}`,
      });

      toast.success(`สร้างคำขอจำหน่ายเลขที่ ${disposalNo} เรียบร้อยแล้ว`);
      setIsCreateOpen(false);
      setAttachmentFile(null);
      reset();
      queryClient.invalidateQueries({ queryKey: ['disposal-requests'] });
      queryClient.invalidateQueries({ queryKey: ['assets-list'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
    } catch (err) {
      toast.error(translateSupabaseError(err));
    }
  };

  const openWorkflowModal = (req: DisposalRequest) => {
    setActiveRequest(req);
    setDocNo(req.document_no || '');
    setDisposalMethod(req.disposal_method || 'write_off');
    setSalvageValue(Number(req.salvage_value || 0));
    setWorkflowNotes(req.notes || '');

    if (req.status === 'draft') setTargetStatus('submitted');
    else if (req.status === 'submitted') setTargetStatus('under_review');
    else if (req.status === 'under_review') setTargetStatus('approved');
    else if (req.status === 'approved') setTargetStatus('disposed');
    else setTargetStatus(req.status);
  };

  const handleExecuteDisposalWorkflow = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeRequest) return;

    setIsProcessing(true);
    try {
      assertSupabaseConfigured();
      const { error: rpcErr } = await supabase.rpc('process_disposal_workflow', {
        p_disposal_id: activeRequest.id,
        p_new_status: targetStatus,
        p_document_no: docNo.trim() || null,
        p_disposal_method: disposalMethod,
        p_salvage_value: Number(salvageValue || 0),
        p_notes: workflowNotes.trim() || null,
      });

      if (rpcErr) throw rpcErr;

      toast.success(
        `อัปเดตสถานะคำขอจำหน่ายเป็น "${DISPOSAL_STATUS_META[targetStatus].label}" สำเร็จ`
      );
      setActiveRequest(null);
      queryClient.invalidateQueries({ queryKey: ['disposal-requests'] });
      queryClient.invalidateQueries({ queryKey: ['assets-list'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
    } catch (err) {
      toast.error(translateSupabaseError(err));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleOpenAttachment = async (path: string) => {
    try {
      const signed = await getSignedFileUrl('disposal-attachments', path, 300);
      window.open(signed, '_blank', 'noopener,noreferrer');
    } catch (err) {
      toast.error(translateSupabaseError(err));
    }
  };

  const filteredRequests = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return requests.filter((r) => {
      if (statusFilter && r.status !== statusFilter) return false;
      if (!q) return true;
      return (
        r.disposal_no.toLowerCase().includes(q) ||
        (r.asset?.asset_code || '').toLowerCase().includes(q) ||
        (r.asset?.name || '').toLowerCase().includes(q) ||
        (r.document_no || '').toLowerCase().includes(q)
      );
    });
  }, [requests, searchTerm, statusFilter]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="การจำหน่าย / แทงจำหน่ายครุภัณฑ์ (Asset Write-off & Disposal)"
        subtitle="ดำเนินการตามขั้นตอน: ร่างคำขอ → ส่งอนุมัติ → อยู่ระหว่างพิจารณา → อนุมัติ/ไม่อนุมัติ → ดำเนินการจำหน่ายแล้ว"
        actions={
          canPropose && (
            <button
              type="button"
              onClick={() => setIsCreateOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-gov-700 px-4 py-2 text-xs font-semibold text-white hover:bg-gov-800"
            >
              <Plus className="h-4 w-4" />
              สร้างคำขอจำหน่ายครุภัณฑ์
            </button>
          )
        }
      />

      {/* ข้อความเตือนด้านกฎหมายและระเบียบพัสดุตามข้อกำหนด */}
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-xs text-amber-950 flex items-start gap-3">
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
        <div>
          <p className="font-bold">ข้อกำหนดการปฏิบัติตามระเบียบพัสดุ:</p>
          <p className="mt-0.5 text-amber-900">
            ระบบนี้ทำหน้าที่บันทึกสถานะ เอกสารอ้างอิง และประวัติการอนุมัติเท่านั้น โดยไม่ตัดสินความถูกต้องทางกฎหมายโดยอัตโนมัติ ผู้มีอำนาจอนุมัติและคณะกรรมการต้องตรวจสอบตามพระราชบัญญัติการจัดซื้อจัดจ้างและการบริหารพัสดุภาครัฐ และระเบียบของหน่วยงานที่ใช้บังคับก่อนอนุมัติขั้นสุดท้าย และเมื่อจำหน่ายแล้วระบบจะปรับสถานะครุภัณฑ์เป็น &ldquo;แทงจำหน่ายแล้ว&rdquo; โดยไม่ลบทิ้งทะเบียนเดิม
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-2xs sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="ค้นหาเลขที่คำขอจำหน่าย, เลขครุภัณฑ์, เลขที่เอกสารอนุมัติ..."
            className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
        >
          <option value="">ทุกสถานะขั้นตอน</option>
          {Object.entries(DISPOSAL_STATUS_META).map(([key, meta]) => (
            <option key={key} value={key}>
              {meta.label}
            </option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <LoadingState message="กำลังโหลดคำขอแทงจำหน่ายครุภัณฑ์..." />
      ) : error ? (
        <ErrorState message={translateSupabaseError(error)} onRetry={() => refetch()} />
      ) : filteredRequests.length === 0 ? (
        <EmptyState
          title="ไม่พบรายการคำขอจำหน่ายครุภัณฑ์"
          description="ยังไม่มีคำขอแทงจำหน่ายในระบบ หรือไม่พบข้อมูลที่ตรงกับตัวกรอง"
        />
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white shadow-2xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs font-semibold text-slate-600 border-b border-slate-200">
                <tr>
                  <th className="p-3.5">เลขที่คำขอ</th>
                  <th className="p-3.5">ครุภัณฑ์ที่เสนอจำหน่าย</th>
                  <th className="p-3.5">สาเหตุและรายละเอียด</th>
                  <th className="p-3.5">ผู้เสนอ / วันที่เสนอ</th>
                  <th className="p-3.5">เลขที่หนังสืออนุมัติ</th>
                  <th className="p-3.5">สถานะ Workflow</th>
                  <th className="p-3.5 text-right">ดำเนินการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {filteredRequests.map((req) => (
                  <tr key={req.id} className="hover:bg-slate-50">
                    <td className="p-3.5 font-mono font-bold text-gov-700 whitespace-nowrap">
                      {req.disposal_no}
                    </td>
                    <td className="p-3.5">
                      <p className="font-mono font-semibold text-slate-900">
                        {req.asset?.asset_code || '-'}
                      </p>
                      <p className="text-slate-600">{req.asset?.name || '-'}</p>
                      <p className="text-[11px] text-slate-400">
                        ราคาทุนเดิม: {formatCurrency(req.asset?.unit_price)}
                      </p>
                    </td>
                    <td className="p-3.5 max-w-xs">
                      <p className="font-semibold text-slate-900">
                        {DISPOSAL_REASON_LABELS[req.reason_type] || req.reason_type}
                      </p>
                      <p className="text-slate-600 mt-0.5">{req.reason_detail}</p>
                    </td>
                    <td className="p-3.5">
                      <p className="font-medium text-slate-900">{req.proposer?.full_name || '-'}</p>
                      <p className="text-slate-500">{formatThaiDate(req.proposed_date)}</p>
                    </td>
                    <td className="p-3.5">
                      <p className="font-medium text-slate-800">{req.document_no || '-'}</p>
                      {req.approver && (
                        <p className="text-[11px] text-slate-500">
                          อนุมัติโดย: {req.approver.full_name}
                        </p>
                      )}
                    </td>
                    <td className="p-3.5">
                      <StatusBadge
                        label={DISPOSAL_STATUS_META[req.status]?.label || req.status}
                        className={DISPOSAL_STATUS_META[req.status]?.badgeClass}
                      />
                    </td>
                    <td className="p-3.5 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5">
                        {req.attachment_path && (
                          <button
                            type="button"
                            onClick={() => handleOpenAttachment(req.attachment_path!)}
                            className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100"
                            title="เปิดดูเอกสารแนบคณะกรรมการ"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </button>
                        )}
                        {canPropose && req.status !== 'disposed' && (
                          <button
                            type="button"
                            onClick={() => openWorkflowModal(req)}
                            className="inline-flex items-center gap-1 rounded-lg bg-gov-700 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-gov-800"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                            ปรับขั้นตอน/อนุมัติ
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

      {/* Modal สร้างคำขอจำหน่าย */}
      <Modal
        open={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        title="สร้างคำขอจำหน่าย / แทงจำหน่ายครุภัณฑ์"
        description="แนบรายงานผลการตรวจสอบสภาพพัสดุและระบุเหตุผลตามระเบียบ"
      >
        <form onSubmit={handleSubmit(onCreateDisposalRequest)} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700">
              เลือกครุภัณฑ์ที่เสนอจำหน่าย <span className="text-rose-600">*</span>
            </label>
            <select
              {...register('asset_id')}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              <option value="">-- เลือกครุภัณฑ์ --</option>
              {assets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.asset_code} — {a.name} ({formatCurrency(a.unit_price)})
                </option>
              ))}
            </select>
            {errors.asset_id && <p className="mt-1 text-xs text-rose-600">{errors.asset_id.message}</p>}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-slate-700">ประเภทสาเหตุการจำหน่าย</label>
              <select
                {...register('reason_type')}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                {Object.entries(DISPOSAL_REASON_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">วันที่เสนอเรื่อง</label>
              <input
                type="date"
                {...register('proposed_date')}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">เลขที่บันทึกข้อความ / เอกสารอ้างอิง</label>
              <input
                type="text"
                placeholder="เช่น กพท 0102/ว.125"
                {...register('document_no')}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">สถานะเริ่มต้นของคำขอ</label>
              <select
                {...register('initial_status')}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold"
              >
                <option value="draft">บันทึกร่างคำขอ (Draft)</option>
                <option value="submitted">ส่งขออนุมัติทันที (Submitted)</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700">
              รายละเอียดเหตุผลและความเห็นคณะกรรมการตรวจสอบสภาพ <span className="text-rose-600">*</span>
            </label>
            <textarea
              rows={3}
              placeholder="อธิบายสภาพความชำรุดเสื่อมสภาพ หรือผลการประเมินค่าซ่อมที่ไม่คุ้มค่า..."
              {...register('reason_detail')}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
            {errors.reason_detail && (
              <p className="mt-1 text-xs text-rose-600">{errors.reason_detail.message}</p>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700">
              แนบเอกสารรายงานการตรวจสอบ / หลักฐานประกอบ (PDF หรือรูปภาพ - Private Bucket)
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
              บันทึกคำขอจำหน่าย
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal ดำเนินการ Workflow จำหน่าย */}
      <Modal
        open={Boolean(activeRequest)}
        onClose={() => setActiveRequest(null)}
        title={`ดำเนินการคำขอจำหน่าย: ${activeRequest?.disposal_no || ''}`}
        description="ทุกการเปลี่ยนสถานะจะถูกบันทึกไว้ใน Audit Log อย่างถาวร"
      >
        {activeRequest && (
          <form onSubmit={handleExecuteDisposalWorkflow} className="space-y-4">
            <div className="rounded-lg bg-slate-50 p-3 text-xs border border-slate-200 space-y-1">
              <p>
                ครุภัณฑ์: <strong>{activeRequest.asset?.asset_code} — {activeRequest.asset?.name}</strong>
              </p>
              <p>
                สถานะปัจจุบัน: <strong>{DISPOSAL_STATUS_META[activeRequest.status]?.label}</strong>
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-semibold text-slate-700">
                  ปรับเป็นสถานะขั้นตอนถัดไป
                </label>
                <select
                  value={targetStatus}
                  onChange={(e) => setTargetStatus(e.target.value as DisposalStatus)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold"
                >
                  <option value="submitted">ส่งขออนุมัติ (Submitted)</option>
                  <option value="under_review">อยู่ระหว่างพิจารณา (Under Review)</option>
                  {isAdmin && (
                    <>
                      <option value="approved">อนุมัติให้จำหน่าย (Approved - เฉพาะ Admin)</option>
                      <option value="rejected">ไม่อนุมัติ (Rejected - เฉพาะ Admin)</option>
                      <option value="disposed">ดำเนินการจำหน่ายแล้ว (Disposed - เฉพาะ Admin)</option>
                    </>
                  )}
                </select>
                {!isAdmin && (
                  <p className="mt-1 text-[11px] text-amber-700">
                    * การอนุมัติขั้นสุดท้ายและการยืนยันจำหน่ายแล้วสงวนสิทธิ์เฉพาะ Admin
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">
                  เลขที่หนังสืออนุมัติ / คำสั่งจำหน่าย
                </label>
                <input
                  type="text"
                  value={docNo}
                  onChange={(e) => setDocNo(e.target.value)}
                  placeholder="ระบุเลขที่เอกสารอนุมัติ..."
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">วิธีการจำหน่ายตามระเบียบ</label>
                <select
                  value={disposalMethod}
                  onChange={(e) => setDisposalMethod(e.target.value as typeof disposalMethod)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="write_off">แทงจำหน่ายเป็นสูญ / ตัดออกจากบัญชี</option>
                  <option value="sale">ขายทอดตลาด</option>
                  <option value="transfer_out">โอนให้หน่วยงานของรัฐหรือองค์กรการกุศล</option>
                  <option value="destroy">แปรสภาพหรือทำลาย</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">
                  มูลค่าซาก / รายได้จากการขายทอดตลาด (บาท)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={salvageValue}
                  onChange={(e) => setSalvageValue(Number(e.target.value))}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">
                ความเห็นผู้พิจารณา / หมายเหตุการอนุมัติ
              </label>
              <textarea
                rows={3}
                value={workflowNotes}
                onChange={(e) => setWorkflowNotes(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setActiveRequest(null)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700"
              >
                ยกเลิก
              </button>
              <button
                type="submit"
                disabled={isProcessing}
                className="inline-flex items-center gap-1.5 rounded-lg bg-gov-700 px-4 py-2 text-xs font-semibold text-white hover:bg-gov-800"
              >
                {isProcessing && <Loader2 className="h-4 w-4 animate-spin" />}
                บันทึกขั้นตอนและ Audit Log
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
