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
  PackageCheck,
  RotateCcw,
  AlertTriangle,
  Loader2,
  Search,
  Edit3,
  Trash2,
} from 'lucide-react';
import { assertSupabaseConfigured, isSupabaseConfigured, recordAuditLog, supabase } from '@/lib/supabase';
import {
  BORROW_STATUS_META,
  translateSupabaseError,
} from '@/lib/utils';
import { formatThaiDate, formatThaiDateTime, getDaysRemaining, toISODateInput } from '@/lib/date';
import { useAuth } from '@/features/auth/AuthContext';
import { useDepartments, useSystemSettings } from '@/hooks/useMasterData';
import {
  ConfirmDialog,
  EmptyState,
  ErrorState,
  LoadingState,
  Modal,
  PageHeader,
  StatusBadge,
} from '@/components/ui/common';
import type { Asset, BorrowRequest, BorrowStatus } from '@/types/database';

const borrowSchema = z.object({
  asset_id: z.string().min(1, 'กรุณาเลือกครุภัณฑ์ที่ต้องการยืม'),
  department_id: z.string().optional(),
  purpose: z.string().min(3, 'กรุณาระบุวัตถุประสงค์การยืมปฏิบัติราชการ'),
  borrow_date: z.string().min(1, 'กรุณาระบุวันที่รับครุภัณฑ์'),
  expected_return_date: z.string().min(1, 'กรุณาระบุวันกำหนดส่งคืน'),
  notes: z.string().optional(),
});

type BorrowFormValues = z.infer<typeof borrowSchema>;

export function BorrowingPage() {
  const { user, profile, hasRole } = useAuth();
  const canApprove = hasRole(['admin', 'asset_officer']);
  const queryClient = useQueryClient();
  const configured = isSupabaseConfigured();

  const { data: departments = [] } = useDepartments();
  const { data: settings } = useSystemSettings();
  const reminderDays = settings?.borrow_reminder_days || 3;

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  // Action Dialog state
  const [activeAction, setActiveAction] = useState<{
    request: BorrowRequest;
    action: 'approve' | 'reject' | 'checkout' | 'checkin';
  } | null>(null);
  const [actionNotes, setActionNotes] = useState('');
  const [returnCondition, setReturnCondition] = useState<'normal' | 'minor_damage' | 'damaged' | 'lost'>('normal');
  const [isProcessing, setIsProcessing] = useState(false);

  // Edit & Delete Borrow Request state
  const [editingBorrow, setEditingBorrow] = useState<BorrowRequest | null>(null);
  const [deletingBorrow, setDeletingBorrow] = useState<BorrowRequest | null>(null);
  const [editBorrowForm, setEditBorrowForm] = useState({
    department_id: '',
    purpose: '',
    borrow_date: '',
    expected_return_date: '',
    status: 'pending' as BorrowStatus,
    notes: '',
  });
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  const {
    data: requests = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['borrow-requests'],
    queryFn: async () => {
      if (!configured) return [] as BorrowRequest[];
      const { data, error: fetchErr } = await supabase
        .from('borrow_requests')
        .select(
          '*, asset:assets(*), requester:profiles!borrow_requests_requester_id_fkey(*), department:departments(*), approver:profiles!borrow_requests_approved_by_fkey(*)'
        )
        .order('created_at', { ascending: false });
      if (fetchErr) throw fetchErr;
      return (data || []) as BorrowRequest[];
    },
  });

  // ดึงเฉพาะครุภัณฑ์ที่มีสถานะ available สำหรับให้เลือกยืม
  const { data: availableAssets = [] } = useQuery({
    queryKey: ['available-assets-for-borrow'],
    queryFn: async () => {
      if (!configured) return [] as Asset[];
      const { data, error: err } = await supabase
        .from('assets')
        .select('*')
        .eq('status', 'available')
        .eq('is_archived', false)
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
  } = useForm<BorrowFormValues>({
    resolver: zodResolver(borrowSchema),
    defaultValues: {
      asset_id: '',
      department_id: profile?.department_id || '',
      purpose: '',
      borrow_date: toISODateInput(),
      expected_return_date: toISODateInput(),
      notes: '',
    },
  });

  const onCreateBorrowRequest = async (values: BorrowFormValues) => {
    try {
      assertSupabaseConfigured();
      if (!user) {
        toast.error('กรุณาเข้าสู่ระบบก่อนส่งคำขอยืม');
        return;
      }

      if (values.expected_return_date < values.borrow_date) {
        toast.error('วันกำหนดส่งคืนต้องไม่น้อยกว่าวันรับครุภัณฑ์');
        return;
      }

      // ตรวจสอบอีกครั้งว่าครุภัณฑ์พร้อมใช้งานและไม่มีรายการยืมค้าง
      const { data: targetAsset } = await supabase
        .from('assets')
        .select('id, asset_code, name, status')
        .eq('id', values.asset_id)
        .single();

      if (!targetAsset || targetAsset.status !== 'available') {
        toast.error('ครุภัณฑ์รายการนี้ไม่พร้อมให้ยืม (อาจถูกยืม อยู่ระหว่างซ่อม หรือจำหน่ายแล้ว)');
        return;
      }

      const reqNo = `BRW-${new Date().getFullYear() + 543}-${String(Date.now()).slice(-5)}`;

      const { data: created, error: insertErr } = await supabase
        .from('borrow_requests')
        .insert({
          request_no: reqNo,
          asset_id: values.asset_id,
          requester_id: user.id,
          department_id: values.department_id || profile?.department_id || null,
          purpose: values.purpose.trim(),
          borrow_date: values.borrow_date,
          expected_return_date: values.expected_return_date,
          status: 'pending',
          notes: values.notes?.trim() || null,
        })
        .select('id')
        .single();

      if (insertErr) throw insertErr;

      await recordAuditLog({
        action: 'BORROW_REQUEST_CREATED',
        entityType: 'borrow_requests',
        entityId: created.id,
        summary: `สร้างคำขอยืมครุภัณฑ์ ${targetAsset.asset_code} เลขที่ ${reqNo}`,
      });

      toast.success(`ส่งคำขอยืมเลขที่ ${reqNo} เรียบร้อยแล้ว`);
      setIsCreateOpen(false);
      reset();
      queryClient.invalidateQueries({ queryKey: ['borrow-requests'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
    } catch (err) {
      toast.error(translateSupabaseError(err));
    }
  };

  const handleExecuteWorkflow = async () => {
    if (!activeAction) return;
    setIsProcessing(true);
    try {
      assertSupabaseConfigured();
      const { error: rpcErr } = await supabase.rpc('process_borrow_workflow', {
        p_request_id: activeAction.request.id,
        p_action: activeAction.action,
        p_notes: actionNotes.trim() || null,
        p_condition: returnCondition,
      });

      if (rpcErr) throw rpcErr;

      const actionTitles = {
        approve: 'อนุมัติคำขอยืมสำเร็จ',
        reject: 'ปฏิเสธคำขอยืมเรียบร้อยแล้ว',
        checkout: 'บันทึกการส่งมอบครุภัณฑ์ให้ผู้ยืมสำเร็จ',
        checkin: 'บันทึกรับคืนครุภัณฑ์และอัปเดตสถานะสำเร็จ',
      };

      toast.success(actionTitles[activeAction.action]);
      setActiveAction(null);
      setActionNotes('');
      queryClient.invalidateQueries({ queryKey: ['borrow-requests'] });
      queryClient.invalidateQueries({ queryKey: ['available-assets-for-borrow'] });
      queryClient.invalidateQueries({ queryKey: ['assets-list'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
    } catch (err) {
      toast.error(translateSupabaseError(err));
    } finally {
      setIsProcessing(false);
    }
  };

  const openEditBorrowModal = (req: BorrowRequest) => {
    setEditingBorrow(req);
    setEditBorrowForm({
      department_id: req.department_id || '',
      purpose: req.purpose,
      borrow_date: req.borrow_date,
      expected_return_date: req.expected_return_date,
      status: req.status,
      notes: req.notes || '',
    });
  };

  const handleSaveEditBorrow = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingBorrow || !editBorrowForm.purpose.trim()) {
      toast.error('กรุณาระบุวัตถุประสงค์การยืม');
      return;
    }
    setIsSavingEdit(true);
    try {
      assertSupabaseConfigured();
      const { error: updErr } = await supabase
        .from('borrow_requests')
        .update({
          department_id: editBorrowForm.department_id || null,
          purpose: editBorrowForm.purpose.trim(),
          borrow_date: editBorrowForm.borrow_date,
          expected_return_date: editBorrowForm.expected_return_date,
          status: editBorrowForm.status,
          notes: editBorrowForm.notes.trim() || null,
        })
        .eq('id', editingBorrow.id);
      if (updErr) throw updErr;

      await recordAuditLog({
        action: 'BORROW_REQUEST_UPDATED',
        entityType: 'borrow_requests',
        entityId: editingBorrow.id,
        summary: `แก้ไขข้อมูลคำขอยืมครุภัณฑ์ เลขที่ ${editingBorrow.request_no}`,
      });

      toast.success('บันทึกการแก้ไขคำขอยืมเรียบร้อยแล้ว');
      setEditingBorrow(null);
      queryClient.invalidateQueries({ queryKey: ['borrow-requests'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
    } catch (err) {
      toast.error(translateSupabaseError(err));
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleConfirmDeleteBorrow = async () => {
    if (!deletingBorrow) return;
    try {
      assertSupabaseConfigured();
      const { error: delErr } = await supabase
        .from('borrow_requests')
        .delete()
        .eq('id', deletingBorrow.id);
      if (delErr) throw delErr;

      if (deletingBorrow.status === 'borrowed' || deletingBorrow.status === 'overdue') {
        await supabase
          .from('assets')
          .update({ status: 'available' })
          .eq('id', deletingBorrow.asset_id);
      }

      await recordAuditLog({
        action: 'BORROW_REQUEST_DELETED',
        entityType: 'borrow_requests',
        entityId: deletingBorrow.id,
        summary: `ลบคำขอยืมครุภัณฑ์ เลขที่ ${deletingBorrow.request_no}`,
      });

      toast.success(`ลบคำขอยืมเลขที่ ${deletingBorrow.request_no} เรียบร้อยแล้ว`);
      setDeletingBorrow(null);
      queryClient.invalidateQueries({ queryKey: ['borrow-requests'] });
      queryClient.invalidateQueries({ queryKey: ['available-assets-for-borrow'] });
      queryClient.invalidateQueries({ queryKey: ['assets-list'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
    } catch (err) {
      toast.error(translateSupabaseError(err));
    }
  };

  // คำนวณรายการใกล้ครบกำหนดหรือเกินกำหนด
  const dueAlerts = useMemo(() => {
    return requests.filter((r) => {
      if (r.status !== 'borrowed' && r.status !== 'overdue') return false;
      const days = getDaysRemaining(r.expected_return_date);
      return days !== null && days <= reminderDays;
    });
  }, [requests, reminderDays]);

  const filteredRequests = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return requests.filter((r) => {
      if (statusFilter && r.status !== statusFilter) return false;
      if (!q) return true;
      return (
        r.request_no.toLowerCase().includes(q) ||
        (r.asset?.asset_code || '').toLowerCase().includes(q) ||
        (r.asset?.name || '').toLowerCase().includes(q) ||
        (r.requester?.full_name || '').toLowerCase().includes(q) ||
        r.purpose.toLowerCase().includes(q)
      );
    });
  }, [requests, searchTerm, statusFilter]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="ระบบการยืม-คืนครุภัณฑ์ (Asset Borrowing & Return)"
        subtitle="ส่งคำขอยืม อนุมัติ บันทึกการจ่ายและรับคืนครุภัณฑ์ พร้อมระบบแจ้งเตือนรายการใกล้ครบกำหนด"
        actions={
          <button
            type="button"
            onClick={() => setIsCreateOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-gov-700 px-4 py-2 text-xs font-semibold text-white hover:bg-gov-800"
          >
            <Plus className="h-4 w-4" />
            สร้างคำขอยืมครุภัณฑ์
          </button>
        }
      />

      {/* แจ้งเตือนรายการใกล้ครบกำหนดหรือเกินกำหนดส่งคืน */}
      {dueAlerts.length > 0 && (
        <div className="rounded-xl border border-rose-300 bg-rose-50 p-4 text-xs text-rose-950">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" />
            <div>
              <p className="font-bold text-sm">
                แจ้งเตือนกำหนดส่งคืนครุภัณฑ์ ({dueAlerts.length} รายการ)
              </p>
              <ul className="mt-1.5 space-y-1 list-disc list-inside">
                {dueAlerts.map((item) => {
                  const days = getDaysRemaining(item.expected_return_date) ?? 0;
                  return (
                    <li key={item.id}>
                      <strong>{item.request_no}</strong> — {item.asset?.asset_code} ({item.asset?.name}) ผู้ยืม:{' '}
                      {item.requester?.full_name || '-'} | กำหนดคืน:{' '}
                      <strong>{formatThaiDate(item.expected_return_date)}</strong>{' '}
                      <span className="font-bold text-rose-700">
                        ({days < 0 ? `เกินกำหนด ${Math.abs(days)} วัน` : days === 0 ? 'ครบกำหนดวันนี้' : `อีก ${days} วันครบกำหนด`})
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* แถบค้นหาและตัวกรอง */}
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-2xs sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="ค้นหาเลขที่ใบยืม, เลขครุภัณฑ์, ชื่อครุภัณฑ์, ผู้ขอยืม..."
            className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
        >
          <option value="">ทุกสถานะการยืม-คืน</option>
          {Object.entries(BORROW_STATUS_META).map(([key, meta]) => (
            <option key={key} value={key}>
              {meta.label}
            </option>
          ))}
        </select>
      </div>

      {/* ตารางรายการคำขอยืม */}
      {isLoading ? (
        <LoadingState message="กำลังโหลดข้อมูลการยืม-คืนครุภัณฑ์..." />
      ) : error ? (
        <ErrorState message={translateSupabaseError(error)} onRetry={() => refetch()} />
      ) : filteredRequests.length === 0 ? (
        <EmptyState
          title="ไม่พบรายการคำขอยืม-คืน"
          description="ยังไม่มีคำขอยืมครุภัณฑ์ในระบบ หรือไม่ตรงกับตัวกรองที่เลือก"
        />
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white shadow-2xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs font-semibold text-slate-600 border-b border-slate-200">
                <tr>
                  <th className="p-3.5">เลขที่คำขอ</th>
                  <th className="p-3.5">ครุภัณฑ์ที่ยืม</th>
                  <th className="p-3.5">ผู้ขอยืม / หน่วยงาน</th>
                  <th className="p-3.5">วัตถุประสงค์</th>
                  <th className="p-3.5">วันรับ - กำหนดคืน</th>
                  <th className="p-3.5">สถานะ</th>
                  <th className="p-3.5 text-right">การดำเนินการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {filteredRequests.map((req) => {
                  const daysLeft = getDaysRemaining(req.expected_return_date);
                  const isOverdue =
                    req.status === 'borrowed' && daysLeft !== null && daysLeft < 0;
                  const effectiveStatus = isOverdue ? 'overdue' : req.status;

                  return (
                    <tr key={req.id} className="hover:bg-slate-50">
                      <td className="p-3.5 font-mono font-bold text-gov-700 whitespace-nowrap">
                        {req.request_no}
                      </td>
                      <td className="p-3.5">
                        <p className="font-mono font-semibold text-slate-900">
                          {req.asset?.asset_code || '-'}
                        </p>
                        <p className="text-slate-600">{req.asset?.name || '-'}</p>
                      </td>
                      <td className="p-3.5">
                        <p className="font-semibold text-slate-900">
                          {req.requester?.full_name || '-'}
                        </p>
                        <p className="text-slate-500">{req.department?.name || '-'}</p>
                      </td>
                      <td className="p-3.5 max-w-xs">
                        <p className="text-slate-800">{req.purpose}</p>
                        {req.rejection_reason && (
                          <p className="text-rose-600 mt-0.5">เหตุผลไม่อนุมัติ: {req.rejection_reason}</p>
                        )}
                      </td>
                      <td className="p-3.5 whitespace-nowrap">
                        <p>
                          รับ: <strong>{formatThaiDate(req.borrow_date)}</strong>
                        </p>
                        <p>
                          กำหนดคืน: <strong>{formatThaiDate(req.expected_return_date)}</strong>
                        </p>
                        {req.actual_return_date && (
                          <p className="text-emerald-700">
                            คืนจริง: {formatThaiDateTime(req.actual_return_date)}
                          </p>
                        )}
                      </td>
                      <td className="p-3.5">
                        <StatusBadge
                          label={BORROW_STATUS_META[effectiveStatus]?.label || effectiveStatus}
                          className={BORROW_STATUS_META[effectiveStatus]?.badgeClass}
                        />
                      </td>
                      <td className="p-3.5 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          {canApprove && (
                            <>
                              {req.status === 'pending' && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setActionNotes('');
                                      setActiveAction({ request: req, action: 'approve' });
                                    }}
                                    className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                                  >
                                    <CheckCircle2 className="h-3.5 w-3.5" />
                                    อนุมัติ
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setActionNotes('');
                                      setActiveAction({ request: req, action: 'reject' });
                                    }}
                                    className="inline-flex items-center gap-1 rounded-lg bg-rose-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-rose-700"
                                  >
                                    <XCircle className="h-3.5 w-3.5" />
                                    ปฏิเสธ
                                  </button>
                                </>
                              )}

                              {req.status === 'approved' && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setActionNotes('');
                                    setReturnCondition('normal');
                                    setActiveAction({ request: req, action: 'checkout' });
                                  }}
                                  className="inline-flex items-center gap-1 rounded-lg bg-gov-700 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-gov-800"
                                >
                                  <PackageCheck className="h-3.5 w-3.5" />
                                  บันทึกจ่ายของ
                                </button>
                              )}

                              {(req.status === 'borrowed' || req.status === 'overdue') && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setActionNotes('');
                                    setReturnCondition('normal');
                                    setActiveAction({ request: req, action: 'checkin' });
                                  }}
                                  className="inline-flex items-center gap-1 rounded-lg bg-sky-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-sky-700"
                                >
                                  <RotateCcw className="h-3.5 w-3.5" />
                                  บันทึกรับคืน
                                </button>
                              )}
                            </>
                          )}

                          {(canApprove || req.requester_id === user?.id) && (
                            <>
                              <button
                                type="button"
                                onClick={() => openEditBorrowModal(req)}
                                className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100"
                                title="แก้ไขข้อมูลคำขอยืม"
                              >
                                <Edit3 className="h-4 w-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeletingBorrow(req)}
                                className="rounded-lg border border-rose-200 p-1.5 text-rose-600 hover:bg-rose-50"
                                title="ลบคำขอยืม"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal สร้างคำขอยืม */}
      <Modal
        open={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        title="ส่งคำขอยืมครุภัณฑ์สำนักงาน"
        description="แสดงเฉพาะครุภัณฑ์ที่มีสถานะพร้อมใช้งาน (Available) เท่านั้น"
      >
        <form onSubmit={handleSubmit(onCreateBorrowRequest)} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700">
              เลือกครุภัณฑ์ที่พร้อมใช้งาน <span className="text-rose-600">*</span>
            </label>
            <select
              {...register('asset_id')}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              <option value="">-- เลือกครุภัณฑ์ (เฉพาะสถานะพร้อมใช้งาน) --</option>
              {availableAssets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.asset_code} — {a.name}
                </option>
              ))}
            </select>
            {errors.asset_id && <p className="mt-1 text-xs text-rose-600">{errors.asset_id.message}</p>}
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700">หน่วยงานผู้ขอยืม</label>
            <select
              {...register('department_id')}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              <option value="">-- เลือกหน่วยงาน --</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.code} - {d.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700">
              วัตถุประสงค์ในการยืมปฏิบัติราชการ <span className="text-rose-600">*</span>
            </label>
            <textarea
              rows={2}
              placeholder="เช่น ใช้สำหรับการประชุมคณะทำงานนอกสถานที่ ณ จังหวัดเชียงใหม่..."
              {...register('purpose')}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
            {errors.purpose && <p className="mt-1 text-xs text-rose-600">{errors.purpose.message}</p>}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-slate-700">
                วันที่ขอรับครุภัณฑ์ <span className="text-rose-600">*</span>
              </label>
              <input
                type="date"
                {...register('borrow_date')}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">
                วันกำหนดส่งคืน <span className="text-rose-600">*</span>
              </label>
              <input
                type="date"
                {...register('expected_return_date')}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700">หมายเหตุเพิ่มเติม</label>
            <input
              type="text"
              {...register('notes')}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
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
              ส่งคำขอยืมครุภัณฑ์
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal ดำเนินการอนุมัติ / ปฏิเสธ / ส่งมอบ / รับคืน */}
      <Modal
        open={Boolean(activeAction)}
        onClose={() => setActiveAction(null)}
        title={
          activeAction?.action === 'approve'
            ? 'อนุมัติคำขอยืมครุภัณฑ์'
            : activeAction?.action === 'reject'
            ? 'ปฏิเสธคำขอยืมครุภัณฑ์'
            : activeAction?.action === 'checkout'
            ? 'บันทึกการจ่ายครุภัณฑ์ให้ผู้ยืม (Checkout)'
            : 'บันทึกรับคืนครุภัณฑ์ (Check-in)'
        }
        maxWidth="max-w-md"
      >
        {activeAction && (
          <div className="space-y-4 text-sm">
            <div className="rounded-lg bg-slate-50 p-3 text-xs space-y-1 border border-slate-200">
              <p>
                เลขที่คำขอ: <strong className="font-mono">{activeAction.request.request_no}</strong>
              </p>
              <p>
                ครุภัณฑ์: <strong>{activeAction.request.asset?.asset_code} — {activeAction.request.asset?.name}</strong>
              </p>
              <p>
                ผู้ขอยืม: <strong>{activeAction.request.requester?.full_name || '-'}</strong>
              </p>
            </div>

            {activeAction.action === 'checkin' && (
              <div>
                <label className="block text-xs font-semibold text-slate-700">
                  สภาพครุภัณฑ์เมื่อรับคืน <span className="text-rose-600">*</span>
                </label>
                <select
                  value={returnCondition}
                  onChange={(e) => setReturnCondition(e.target.value as typeof returnCondition)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold"
                >
                  <option value="normal">สภาพปกติ พร้อมใช้งานต่อ (เปลี่ยนสถานะเป็น พร้อมใช้งาน)</option>
                  <option value="minor_damage">มีรอยขีดข่วนเล็กน้อย ใช้งานได้ปกติ</option>
                  <option value="damaged">ชำรุด ต้องส่งซ่อมบำรุง (เปลี่ยนสถานะเป็น อยู่ระหว่างซ่อม)</option>
                  <option value="lost">สูญหาย (เปลี่ยนสถานะเป็น สูญหาย/รอตรวจสอบ)</option>
                </select>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-700">
                {activeAction.action === 'reject' ? 'เหตุผลที่ไม่อนุมัติ *' : 'หมายเหตุการดำเนินการ'}
              </label>
              <textarea
                rows={3}
                value={actionNotes}
                onChange={(e) => setActionNotes(e.target.value)}
                placeholder="ระบุเหตุผลหรือบันทึกสภาพครุภัณฑ์..."
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
              />
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setActiveAction(null)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                disabled={isProcessing || (activeAction.action === 'reject' && !actionNotes.trim())}
                onClick={handleExecuteWorkflow}
                className="inline-flex items-center gap-1.5 rounded-lg bg-gov-700 px-4 py-2 text-xs font-semibold text-white hover:bg-gov-800 disabled:opacity-50"
              >
                {isProcessing && <Loader2 className="h-4 w-4 animate-spin" />}
                ยืนยันการดำเนินการ
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Modal แก้ไขคำขอยืม */}
      <Modal
        open={Boolean(editingBorrow)}
        onClose={() => setEditingBorrow(null)}
        title={`แก้ไขคำขอยืม: ${editingBorrow?.request_no || ''}`}
      >
        {editingBorrow && (
          <form onSubmit={handleSaveEditBorrow} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700">หน่วยงานผู้ขอยืม</label>
              <select
                value={editBorrowForm.department_id}
                onChange={(e) => setEditBorrowForm({ ...editBorrowForm, department_id: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                <option value="">-- เลือกหน่วยงาน --</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.code} - {d.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">
                วัตถุประสงค์ในการยืม <span className="text-rose-600">*</span>
              </label>
              <textarea
                rows={2}
                value={editBorrowForm.purpose}
                onChange={(e) => setEditBorrowForm({ ...editBorrowForm, purpose: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-semibold text-slate-700">วันที่รับครุภัณฑ์</label>
                <input
                  type="date"
                  value={editBorrowForm.borrow_date}
                  onChange={(e) => setEditBorrowForm({ ...editBorrowForm, borrow_date: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">วันกำหนดส่งคืน</label>
                <input
                  type="date"
                  value={editBorrowForm.expected_return_date}
                  onChange={(e) =>
                    setEditBorrowForm({ ...editBorrowForm, expected_return_date: e.target.value })
                  }
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
            </div>

            {canApprove && (
              <div>
                <label className="block text-xs font-semibold text-slate-700">สถานะคำขอ</label>
                <select
                  value={editBorrowForm.status}
                  onChange={(e) =>
                    setEditBorrowForm({ ...editBorrowForm, status: e.target.value as BorrowStatus })
                  }
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold"
                >
                  {Object.entries(BORROW_STATUS_META).map(([k, m]) => (
                    <option key={k} value={k}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-700">หมายเหตุ</label>
              <input
                type="text"
                value={editBorrowForm.notes}
                onChange={(e) => setEditBorrowForm({ ...editBorrowForm, notes: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setEditingBorrow(null)}
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
        open={Boolean(deletingBorrow)}
        onClose={() => setDeletingBorrow(null)}
        onConfirm={handleConfirmDeleteBorrow}
        title="ยืนยันการลบคำขอยืมครุภัณฑ์"
        description={`คุณต้องการลบคำขอยืมเลขที่ "${deletingBorrow?.request_no || ''}" (${deletingBorrow?.asset?.asset_code || ''}) ออกจากระบบใช่หรือไม่?`}
        confirmLabel="ยืนยันลบคำขอยืม"
      />
    </div>
  );
}
