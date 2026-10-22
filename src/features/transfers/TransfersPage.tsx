import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import {
  Plus,
  CheckCircle2,
  XCircle,
  Loader2,
  Search,
  Edit3,
  Trash2,
} from 'lucide-react';
import { assertSupabaseConfigured, isSupabaseConfigured, recordAuditLog, supabase } from '@/lib/supabase';
import { TRANSFER_STATUS_META, translateSupabaseError } from '@/lib/utils';
import { formatThaiDate, toISODateInput } from '@/lib/date';
import { useAuth } from '@/features/auth/AuthContext';
import { useDepartments, useLocations, useProfiles } from '@/hooks/useMasterData';
import {
  ConfirmDialog,
  EmptyState,
  ErrorState,
  LoadingState,
  Modal,
  PageHeader,
  StatusBadge,
} from '@/components/ui/common';
import type { Asset, AssetTransfer, TransferStatus } from '@/types/database';

const transferSchema = z.object({
  asset_id: z.string().min(1, 'กรุณาเลือกครุภัณฑ์ที่ต้องการโอนย้าย'),
  to_department_id: z.string().min(1, 'กรุณาเลือกหน่วยงานปลายทาง'),
  to_location_id: z.string().optional(),
  to_custodian_id: z.string().optional(),
  effective_date: z.string().min(1, 'กรุณาระบุวันที่มีผลโอนย้าย'),
  reason: z.string().min(3, 'กรุณาระบุเหตุผลในการโอนย้ายครุภัณฑ์'),
  notes: z.string().optional(),
});

type TransferFormValues = z.infer<typeof transferSchema>;

export function TransfersPage() {
  const { user, hasRole } = useAuth();
  const canApprove = hasRole(['admin', 'asset_officer']);
  const queryClient = useQueryClient();
  const configured = isSupabaseConfigured();

  const { data: departments = [] } = useDepartments();
  const { data: locations = [] } = useLocations();
  const { data: profiles = [] } = useProfiles();

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const [approvalTarget, setApprovalTarget] = useState<{
    transfer: AssetTransfer;
    approved: boolean;
  } | null>(null);
  const [approvalReason, setApprovalReason] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  // Edit & Delete Transfer state
  const [editingTransfer, setEditingTransfer] = useState<AssetTransfer | null>(null);
  const [deletingTransfer, setDeletingTransfer] = useState<AssetTransfer | null>(null);
  const [editTransferForm, setEditTransferForm] = useState({
    to_department_id: '',
    to_location_id: '',
    to_custodian_id: '',
    effective_date: '',
    reason: '',
    status: 'pending' as TransferStatus,
    notes: '',
  });
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  const {
    data: transfers = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['asset-transfers'],
    queryFn: async () => {
      if (!configured) return [] as AssetTransfer[];
      const { data, error: fetchErr } = await supabase
        .from('asset_transfers')
        .select(
          '*, asset:assets(*), from_department:departments!asset_transfers_from_department_id_fkey(*), to_department:departments!asset_transfers_to_department_id_fkey(*), from_location:locations!asset_transfers_from_location_id_fkey(*), to_location:locations!asset_transfers_to_location_id_fkey(*), from_custodian:profiles!asset_transfers_from_custodian_id_fkey(*), to_custodian:profiles!asset_transfers_to_custodian_id_fkey(*), requester:profiles!asset_transfers_requested_by_fkey(*)'
        )
        .order('created_at', { ascending: false });
      if (fetchErr) throw fetchErr;
      return (data || []) as AssetTransfer[];
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
  } = useForm<TransferFormValues>({
    resolver: zodResolver(transferSchema),
    defaultValues: {
      asset_id: '',
      to_department_id: '',
      to_location_id: '',
      to_custodian_id: '',
      effective_date: toISODateInput(),
      reason: '',
      notes: '',
    },
  });

  const onCreateTransfer = async (values: TransferFormValues) => {
    try {
      assertSupabaseConfigured();
      const targetAsset = assets.find((a) => a.id === values.asset_id);
      if (!targetAsset) {
        toast.error('ไม่พบข้อมูลครุภัณฑ์ที่เลือก');
        return;
      }

      const transferNo = `TRF-${new Date().getFullYear() + 543}-${String(Date.now()).slice(-5)}`;

      const { data: created, error: insertErr } = await supabase
        .from('asset_transfers')
        .insert({
          transfer_no: transferNo,
          asset_id: targetAsset.id,
          from_department_id: targetAsset.department_id,
          to_department_id: values.to_department_id,
          from_location_id: targetAsset.location_id,
          to_location_id: values.to_location_id || null,
          from_custodian_id: targetAsset.custodian_id,
          to_custodian_id: values.to_custodian_id || null,
          reason: values.reason.trim(),
          effective_date: values.effective_date,
          status: 'pending',
          requested_by: user?.id || null,
          notes: values.notes?.trim() || null,
        })
        .select('id')
        .single();

      if (insertErr) throw insertErr;

      await recordAuditLog({
        action: 'TRANSFER_REQUEST_CREATED',
        entityType: 'asset_transfers',
        entityId: created.id,
        summary: `สร้างคำขอโอนย้ายครุภัณฑ์ ${targetAsset.asset_code} เลขที่ ${transferNo}`,
      });

      toast.success(`ส่งคำขอโอนย้ายเลขที่ ${transferNo} เรียบร้อยแล้ว`);
      setIsCreateOpen(false);
      reset();
      queryClient.invalidateQueries({ queryKey: ['asset-transfers'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
    } catch (err) {
      toast.error(translateSupabaseError(err));
    }
  };

  const handleConfirmApproval = async () => {
    if (!approvalTarget) return;
    setIsProcessing(true);
    try {
      assertSupabaseConfigured();
      // เรียก Database RPC เพื่ออัปเดตทั้ง asset_transfers และ assets ใน Transaction เดียวกัน
      const { error: rpcErr } = await supabase.rpc('approve_asset_transfer', {
        p_transfer_id: approvalTarget.transfer.id,
        p_approved: approvalTarget.approved,
        p_reason: approvalReason.trim() || null,
      });

      if (rpcErr) throw rpcErr;

      toast.success(
        approvalTarget.approved
          ? 'อนุมัติโอนย้ายและอัปเดตสถานที่/ผู้รับผิดชอบครุภัณฑ์สำเร็จ'
          : 'ปฏิเสธคำขอโอนย้ายเรียบร้อยแล้ว'
      );

      setApprovalTarget(null);
      setApprovalReason('');
      queryClient.invalidateQueries({ queryKey: ['asset-transfers'] });
      queryClient.invalidateQueries({ queryKey: ['assets-list'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
    } catch (err) {
      toast.error(translateSupabaseError(err));
    } finally {
      setIsProcessing(false);
    }
  };

  const openEditTransferModal = (tr: AssetTransfer) => {
    setEditingTransfer(tr);
    setEditTransferForm({
      to_department_id: tr.to_department_id || '',
      to_location_id: tr.to_location_id || '',
      to_custodian_id: tr.to_custodian_id || '',
      effective_date: tr.effective_date,
      reason: tr.reason,
      status: tr.status,
      notes: tr.notes || '',
    });
  };

  const handleSaveEditTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTransfer || !editTransferForm.to_department_id || !editTransferForm.reason.trim()) {
      toast.error('กรุณาระบุหน่วยงานปลายทางและเหตุผลในการโอนย้าย');
      return;
    }
    setIsSavingEdit(true);
    try {
      assertSupabaseConfigured();
      const { error: updErr } = await supabase
        .from('asset_transfers')
        .update({
          to_department_id: editTransferForm.to_department_id,
          to_location_id: editTransferForm.to_location_id || null,
          to_custodian_id: editTransferForm.to_custodian_id || null,
          effective_date: editTransferForm.effective_date,
          reason: editTransferForm.reason.trim(),
          status: editTransferForm.status,
          notes: editTransferForm.notes.trim() || null,
        })
        .eq('id', editingTransfer.id);
      if (updErr) throw updErr;

      await recordAuditLog({
        action: 'TRANSFER_REQUEST_UPDATED',
        entityType: 'asset_transfers',
        entityId: editingTransfer.id,
        summary: `แก้ไขใบโอนย้ายครุภัณฑ์เลขที่ ${editingTransfer.transfer_no}`,
      });

      toast.success('บันทึกการแก้ไขใบโอนย้ายสำเร็จ');
      setEditingTransfer(null);
      queryClient.invalidateQueries({ queryKey: ['asset-transfers'] });
    } catch (err) {
      toast.error(translateSupabaseError(err));
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleConfirmDeleteTransfer = async () => {
    if (!deletingTransfer) return;
    try {
      assertSupabaseConfigured();
      const { error: delErr } = await supabase
        .from('asset_transfers')
        .delete()
        .eq('id', deletingTransfer.id);
      if (delErr) throw delErr;

      await recordAuditLog({
        action: 'TRANSFER_REQUEST_DELETED',
        entityType: 'asset_transfers',
        entityId: deletingTransfer.id,
        summary: `ลบใบโอนย้ายครุภัณฑ์เลขที่ ${deletingTransfer.transfer_no}`,
      });

      toast.success(`ลบใบโอนย้ายเลขที่ ${deletingTransfer.transfer_no} เรียบร้อยแล้ว`);
      setDeletingTransfer(null);
      queryClient.invalidateQueries({ queryKey: ['asset-transfers'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
    } catch (err) {
      toast.error(translateSupabaseError(err));
    }
  };

  const filteredTransfers = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return transfers.filter((t) => {
      if (statusFilter && t.status !== statusFilter) return false;
      if (!q) return true;
      return (
        t.transfer_no.toLowerCase().includes(q) ||
        (t.asset?.asset_code || '').toLowerCase().includes(q) ||
        (t.asset?.name || '').toLowerCase().includes(q) ||
        t.reason.toLowerCase().includes(q)
      );
    });
  }, [transfers, searchTerm, statusFilter]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="ระบบโอนย้ายครุภัณฑ์ (Asset Location & Custodian Transfer)"
        subtitle="สร้างคำขอโอนย้ายหน่วยงาน อาคาร/ห้อง หรือผู้รับผิดชอบดูแล พร้อมบันทึกประวัติการย้ายอย่างครบถ้วน"
        actions={
          <button
            type="button"
            onClick={() => setIsCreateOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-gov-700 px-4 py-2 text-xs font-semibold text-white hover:bg-gov-800"
          >
            <Plus className="h-4 w-4" />
            สร้างคำขอโอนย้ายครุภัณฑ์
          </button>
        }
      />

      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-2xs sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="ค้นหาเลขที่ใบโอนย้าย, เลขครุภัณฑ์, ชื่อครุภัณฑ์..."
            className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
        >
          <option value="">ทุกสถานะการโอนย้าย</option>
          {Object.entries(TRANSFER_STATUS_META).map(([key, meta]) => (
            <option key={key} value={key}>
              {meta.label}
            </option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <LoadingState message="กำลังโหลดประวัติการโอนย้ายครุภัณฑ์..." />
      ) : error ? (
        <ErrorState message={translateSupabaseError(error)} onRetry={() => refetch()} />
      ) : filteredTransfers.length === 0 ? (
        <EmptyState
          title="ไม่พบรายการโอนย้ายครุภัณฑ์"
          description="ยังไม่มีคำขอหรือประวัติการโอนย้ายครุภัณฑ์ในระบบ"
        />
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white shadow-2xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs font-semibold text-slate-600 border-b border-slate-200">
                <tr>
                  <th className="p-3.5">เลขที่ใบโอน</th>
                  <th className="p-3.5">ครุภัณฑ์</th>
                  <th className="p-3.5">ต้นทาง (เดิม)</th>
                  <th className="p-3.5">ปลายทาง (ใหม่)</th>
                  <th className="p-3.5">เหตุผล / วันที่มีผล</th>
                  <th className="p-3.5">สถานะ</th>
                  <th className="p-3.5 text-right">การอนุมัติ / จัดการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {filteredTransfers.map((tr) => (
                  <tr key={tr.id} className="hover:bg-slate-50">
                    <td className="p-3.5 font-mono font-bold text-gov-700 whitespace-nowrap">
                      {tr.transfer_no}
                    </td>
                    <td className="p-3.5">
                      <p className="font-mono font-semibold text-slate-900">
                        {tr.asset?.asset_code || '-'}
                      </p>
                      <p className="text-slate-600">{tr.asset?.name || '-'}</p>
                    </td>
                    <td className="p-3.5">
                      <p className="font-medium text-slate-800">{tr.from_department?.name || '-'}</p>
                      <p className="text-slate-500">
                        {tr.from_location
                          ? `${tr.from_location.building} ห้อง ${tr.from_location.room || '-'}`
                          : 'ไม่ระบุห้อง'}
                      </p>
                      <p className="text-slate-400">ผู้ดูแลเดิม: {tr.from_custodian?.full_name || '-'}</p>
                    </td>
                    <td className="p-3.5">
                      <p className="font-semibold text-emerald-800">{tr.to_department?.name || '-'}</p>
                      <p className="text-slate-600">
                        {tr.to_location
                          ? `${tr.to_location.building} ห้อง ${tr.to_location.room || '-'}`
                          : 'ไม่ระบุห้อง'}
                      </p>
                      <p className="text-slate-500">ผู้ดูแลใหม่: {tr.to_custodian?.full_name || '-'}</p>
                    </td>
                    <td className="p-3.5">
                      <p className="text-slate-900">{tr.reason}</p>
                      <p className="text-slate-500 mt-0.5">
                        มีผลวันที่: <strong>{formatThaiDate(tr.effective_date)}</strong>
                      </p>
                    </td>
                    <td className="p-3.5">
                      <StatusBadge
                        label={TRANSFER_STATUS_META[tr.status]?.label || tr.status}
                        className={TRANSFER_STATUS_META[tr.status]?.badgeClass}
                      />
                    </td>
                    <td className="p-3.5 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5">
                        {canApprove && tr.status === 'pending' && (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                setApprovalReason('');
                                setApprovalTarget({ transfer: tr, approved: true });
                              }}
                              className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              อนุมัติโอนย้าย
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setApprovalReason('');
                                setApprovalTarget({ transfer: tr, approved: false });
                              }}
                              className="inline-flex items-center gap-1 rounded-lg bg-rose-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-rose-700"
                            >
                              <XCircle className="h-3.5 w-3.5" />
                              ปฏิเสธ
                            </button>
                          </>
                        )}
                        {(canApprove || tr.requested_by === user?.id) && (
                          <>
                            <button
                              type="button"
                              onClick={() => openEditTransferModal(tr)}
                              className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100"
                              title="แก้ไขใบโอนย้าย"
                            >
                              <Edit3 className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeletingTransfer(tr)}
                              className="rounded-lg border border-rose-200 p-1.5 text-rose-600 hover:bg-rose-50"
                              title="ลบใบโอนย้าย"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </>
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

      {/* Modal สร้างคำขอโอนย้าย */}
      <Modal
        open={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        title="สร้างคำขอโอนย้ายสถานที่หรือผู้รับผิดชอบครุภัณฑ์"
        description="เมื่อได้รับการอนุมัติ ระบบจะปรับปรุงข้อมูลปัจจุบันของครุภัณฑ์และบันทึกประวัติการย้ายโดยอัตโนมัติ"
      >
        <form onSubmit={handleSubmit(onCreateTransfer)} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700">
              เลือกครุภัณฑ์ที่ต้องการโอนย้าย <span className="text-rose-600">*</span>
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

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-slate-700">
                หน่วยงานปลายทาง (ใหม่) <span className="text-rose-600">*</span>
              </label>
              <select
                {...register('to_department_id')}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                <option value="">-- เลือกหน่วยงานใหม่ --</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.code} - {d.name}
                  </option>
                ))}
              </select>
              {errors.to_department_id && (
                <p className="mt-1 text-xs text-rose-600">{errors.to_department_id.message}</p>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">
                อาคาร / ห้อง / สถานที่ตั้งใหม่
              </label>
              <select
                {...register('to_location_id')}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                <option value="">-- เลือกสถานที่ตั้งใหม่ --</option>
                {locations.map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.building} ห้อง {loc.room || '-'} ({loc.name})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">ผู้รับผิดชอบคนใหม่</label>
              <select
                {...register('to_custodian_id')}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                <option value="">-- เลือกผู้รับผิดชอบคนใหม่ --</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name} ({p.email})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">
                วันที่มีผลโอนย้าย <span className="text-rose-600">*</span>
              </label>
              <input
                type="date"
                {...register('effective_date')}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700">
              เหตุผลในการโอนย้าย <span className="text-rose-600">*</span>
            </label>
            <textarea
              rows={2}
              placeholder="ระบุเหตุผลหรืออ้างอิงบันทึกข้อความขอโอนย้ายพัสดุ..."
              {...register('reason')}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
            {errors.reason && <p className="mt-1 text-xs text-rose-600">{errors.reason.message}</p>}
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
              บันทึกคำขอโอนย้าย
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal ยืนยันอนุมัติหรือปฏิเสธ */}
      <Modal
        open={Boolean(approvalTarget)}
        onClose={() => setApprovalTarget(null)}
        title={
          approvalTarget?.approved
            ? 'ยืนยันการอนุมัติโอนย้ายครุภัณฑ์'
            : 'ปฏิเสธคำขอโอนย้ายครุภัณฑ์'
        }
        maxWidth="max-w-md"
      >
        {approvalTarget && (
          <div className="space-y-4 text-sm">
            <div className="rounded-lg bg-slate-50 p-3 text-xs space-y-1 border border-slate-200">
              <p>เลขที่ใบโอน: <strong className="font-mono">{approvalTarget.transfer.transfer_no}</strong></p>
              <p>ครุภัณฑ์: <strong>{approvalTarget.transfer.asset?.asset_code} — {approvalTarget.transfer.asset?.name}</strong></p>
              <p>โอนไปยัง: <strong>{approvalTarget.transfer.to_department?.name || '-'}</strong></p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">
                {approvalTarget.approved ? 'หมายเหตุการอนุมัติ (ถ้ามี)' : 'เหตุผลที่ไม่อนุมัติ *'}
              </label>
              <textarea
                rows={2}
                value={approvalReason}
                onChange={(e) => setApprovalReason(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
              />
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setApprovalTarget(null)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                disabled={isProcessing || (!approvalTarget.approved && !approvalReason.trim())}
                onClick={handleConfirmApproval}
                className="inline-flex items-center gap-1.5 rounded-lg bg-gov-700 px-4 py-2 text-xs font-semibold text-white hover:bg-gov-800 disabled:opacity-50"
              >
                {isProcessing && <Loader2 className="h-4 w-4 animate-spin" />}
                ยืนยันดำเนินการ
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Modal แก้ไขใบโอนย้าย */}
      <Modal
        open={Boolean(editingTransfer)}
        onClose={() => setEditingTransfer(null)}
        title={`แก้ไขใบโอนย้าย: ${editingTransfer?.transfer_no || ''}`}
      >
        {editingTransfer && (
          <form onSubmit={handleSaveEditTransfer} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-semibold text-slate-700">หน่วยงานปลายทาง *</label>
                <select
                  value={editTransferForm.to_department_id}
                  onChange={(e) =>
                    setEditTransferForm({ ...editTransferForm, to_department_id: e.target.value })
                  }
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="">-- เลือกหน่วยงานใหม่ --</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.code} - {d.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700">สถานที่ตั้งใหม่</label>
                <select
                  value={editTransferForm.to_location_id}
                  onChange={(e) =>
                    setEditTransferForm({ ...editTransferForm, to_location_id: e.target.value })
                  }
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="">-- เลือกสถานที่ตั้งใหม่ --</option>
                  {locations.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.building} ห้อง {loc.room || '-'} ({loc.name})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700">ผู้รับผิดชอบคนใหม่</label>
                <select
                  value={editTransferForm.to_custodian_id}
                  onChange={(e) =>
                    setEditTransferForm({ ...editTransferForm, to_custodian_id: e.target.value })
                  }
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="">-- เลือกผู้รับผิดชอบคนใหม่ --</option>
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.full_name} ({p.email})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700">วันที่มีผลโอนย้าย *</label>
                <input
                  type="date"
                  value={editTransferForm.effective_date}
                  onChange={(e) =>
                    setEditTransferForm({ ...editTransferForm, effective_date: e.target.value })
                  }
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
            </div>

            {canApprove && (
              <div>
                <label className="block text-xs font-semibold text-slate-700">สถานะใบโอนย้าย</label>
                <select
                  value={editTransferForm.status}
                  onChange={(e) =>
                    setEditTransferForm({
                      ...editTransferForm,
                      status: e.target.value as TransferStatus,
                    })
                  }
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold"
                >
                  {Object.entries(TRANSFER_STATUS_META).map(([k, m]) => (
                    <option key={k} value={k}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-700">เหตุผลในการโอนย้าย *</label>
              <textarea
                rows={2}
                value={editTransferForm.reason}
                onChange={(e) =>
                  setEditTransferForm({ ...editTransferForm, reason: e.target.value })
                }
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">หมายเหตุ</label>
              <input
                type="text"
                value={editTransferForm.notes}
                onChange={(e) =>
                  setEditTransferForm({ ...editTransferForm, notes: e.target.value })
                }
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setEditingTransfer(null)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700"
              >
                ยกเลิก
              </button>
              <button
                type="submit"
                disabled={isSavingEdit}
                className="inline-flex items-center gap-1.5 rounded-lg bg-gov-700 px-4 py-2 text-xs font-semibold text-white hover:bg-gov-800"
              >
                {isSavingEdit && <Loader2 className="h-4 w-4 animate-spin" />}
                บันทึกการแก้ไข
              </button>
            </div>
          </form>
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(deletingTransfer)}
        onClose={() => setDeletingTransfer(null)}
        onConfirm={handleConfirmDeleteTransfer}
        title="ยืนยันการลบใบโอนย้ายครุภัณฑ์"
        description={`คุณต้องการลบใบโอนย้ายเลขที่ "${deletingTransfer?.transfer_no || ''}" ออกจากระบบใช่หรือไม่?`}
        confirmLabel="ยืนยันลบใบโอนย้าย"
      />
    </div>
  );
}
