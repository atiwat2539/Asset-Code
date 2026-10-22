import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import {
  ClipboardCheck,
  Plus,
  QrCode,
  FileSpreadsheet,
  FileText,
  CheckCircle2,
  Loader2,
  Edit3,
  Trash2,
} from 'lucide-react';
import { assertSupabaseConfigured, isSupabaseConfigured, recordAuditLog, supabase } from '@/lib/supabase';
import {
  INVENTORY_RESULT_META,
  translateSupabaseError,
} from '@/lib/utils';
import { formatThaiDate, formatThaiDateTime, getThaiFiscalYear, toISODateInput } from '@/lib/date';
import { exportToExcel, exportToPDF } from '@/lib/export';
import { useAuth } from '@/features/auth/AuthContext';
import { useDepartments, useLocations, useProfiles, useSystemSettings } from '@/hooks/useMasterData';
import {
  ConfirmDialog,
  EmptyState,
  LoadingState,
  Modal,
  PageHeader,
  StatusBadge,
} from '@/components/ui/common';
import type { Asset, InventoryItem, InventoryResultStatus, InventorySession } from '@/types/database';

const sessionSchema = z.object({
  session_code: z.string().min(2, 'กรุณาระบุรหัสรอบตรวจนับ'),
  name: z.string().min(2, 'กรุณาระบุชื่อรอบการตรวจนับ'),
  fiscal_year: z.coerce.number().min(2500).max(2700),
  start_date: z.string().min(1, 'กรุณาระบุวันเริ่มต้น'),
  end_date: z.string().min(1, 'กรุณาระบุวันสิ้นสุด'),
  department_id: z.string().optional(),
  responsible_id: z.string().optional(),
  notes: z.string().optional(),
});

type SessionFormValues = z.infer<typeof sessionSchema>;

export function InventoryPage() {
  const { user, hasRole } = useAuth();
  const canManage = hasRole(['admin', 'asset_officer']);
  const queryClient = useQueryClient();
  const configured = isSupabaseConfigured();

  const { data: departments = [] } = useDepartments();
  const { data: locations = [] } = useLocations();
  const { data: profiles = [] } = useProfiles();
  const { data: settings } = useSystemSettings();

  const [selectedSessionId, setSelectedSessionId] = useState<string>('');
  const [isSessionModalOpen, setIsSessionModalOpen] = useState(false);
  const [editingSession, setEditingSession] = useState<InventorySession | null>(null);
  const [deletingSession, setDeletingSession] = useState<InventorySession | null>(null);
  const [deletingItem, setDeletingItem] = useState<InventoryItem | null>(null);

  // ฟอร์มบันทึกผลตรวจนับ
  const [scanCode, setScanCode] = useState('');
  const [selectedAssetId, setSelectedAssetId] = useState('');
  const [resultStatus, setResultStatus] = useState<InventoryResultStatus>('found_normal');
  const [actualLocationId, setActualLocationId] = useState('');
  const [itemNotes, setItemNotes] = useState('');
  const [isSavingItem, setIsSavingItem] = useState(false);

  const { data: sessions = [], isLoading: loadingSessions } = useQuery({
    queryKey: ['inventory-sessions'],
    queryFn: async () => {
      if (!configured) return [] as InventorySession[];
      const { data, error } = await supabase
        .from('inventory_sessions')
        .select('*, department:departments(*), responsible:profiles!inventory_sessions_responsible_id_fkey(*)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as InventorySession[];
    },
  });

  const activeSession = useMemo(() => {
    if (selectedSessionId) {
      return sessions.find((s) => s.id === selectedSessionId) || sessions[0] || null;
    }
    return sessions[0] || null;
  }, [sessions, selectedSessionId]);

  const { data: assets = [] } = useQuery({
    queryKey: ['assets-list'],
    queryFn: async () => {
      if (!configured) return [] as Asset[];
      const { data, error } = await supabase
        .from('assets')
        .select('*, department:departments(*), location:locations(*)')
        .eq('is_archived', false)
        .neq('status', 'disposed')
        .order('asset_code', { ascending: true });
      if (error) throw error;
      return (data || []) as Asset[];
    },
  });

  const { data: sessionItems = [], isLoading: loadingItems } = useQuery({
    queryKey: ['inventory-items', activeSession?.id],
    enabled: Boolean(activeSession?.id),
    queryFn: async () => {
      if (!configured || !activeSession?.id) return [] as InventoryItem[];
      const { data, error } = await supabase
        .from('inventory_items')
        .select(
          '*, asset:assets(*, department:departments(*)), expected_location:locations!inventory_items_expected_location_id_fkey(*), actual_location:locations!inventory_items_actual_location_id_fkey(*), inspector:profiles!inventory_items_inspected_by_fkey(*)'
        )
        .eq('session_id', activeSession.id)
        .order('inspected_at', { ascending: false });
      if (error) throw error;
      return (data || []) as InventoryItem[];
    },
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<SessionFormValues>({
    resolver: zodResolver(sessionSchema),
    defaultValues: {
      session_code: `INV-${getThaiFiscalYear()}-01`,
      name: `การตรวจสอบพัสดุประจำปีงบประมาณ พ.ศ. ${getThaiFiscalYear()}`,
      fiscal_year: getThaiFiscalYear(),
      start_date: toISODateInput(),
      end_date: toISODateInput(),
      department_id: '',
      responsible_id: '',
      notes: '',
    },
  });

  const openCreateSessionModal = () => {
    setEditingSession(null);
    reset({
      session_code: `INV-${getThaiFiscalYear()}-${String(sessions.length + 1).padStart(2, '0')}`,
      name: `การตรวจสอบพัสดุประจำปีงบประมาณ พ.ศ. ${getThaiFiscalYear()}`,
      fiscal_year: getThaiFiscalYear(),
      start_date: toISODateInput(),
      end_date: toISODateInput(),
      department_id: '',
      responsible_id: '',
      notes: '',
    });
    setIsSessionModalOpen(true);
  };

  const openEditSessionModal = (session: InventorySession) => {
    setEditingSession(session);
    reset({
      session_code: session.session_code,
      name: session.name,
      fiscal_year: session.fiscal_year,
      start_date: session.start_date,
      end_date: session.end_date,
      department_id: session.department_id || '',
      responsible_id: session.responsible_id || '',
      notes: session.notes || '',
    });
    setIsSessionModalOpen(true);
  };

  const onCreateSession = async (values: SessionFormValues) => {
    try {
      assertSupabaseConfigured();
      if (values.end_date < values.start_date) {
        toast.error('วันสิ้นสุดต้องไม่น้อยกว่าวันเริ่มต้น');
        return;
      }

      if (editingSession) {
        const { error } = await supabase
          .from('inventory_sessions')
          .update({
            session_code: values.session_code.trim(),
            name: values.name.trim(),
            fiscal_year: values.fiscal_year,
            start_date: values.start_date,
            end_date: values.end_date,
            department_id: values.department_id || null,
            responsible_id: values.responsible_id || user?.id || null,
            notes: values.notes?.trim() || null,
          })
          .eq('id', editingSession.id);

        if (error) throw error;

        await recordAuditLog({
          action: 'INVENTORY_SESSION_UPDATED',
          entityType: 'inventory_sessions',
          entityId: editingSession.id,
          summary: `แก้ไขรอบตรวจนับครุภัณฑ์ ${values.session_code} (${values.name})`,
        });

        toast.success('แก้ไขข้อมูลรอบตรวจนับสำเร็จ');
      } else {
        const { data, error } = await supabase
          .from('inventory_sessions')
          .insert({
            session_code: values.session_code.trim(),
            name: values.name.trim(),
            fiscal_year: values.fiscal_year,
            start_date: values.start_date,
            end_date: values.end_date,
            department_id: values.department_id || null,
            responsible_id: values.responsible_id || user?.id || null,
            notes: values.notes?.trim() || null,
            status: 'in_progress',
            created_by: user?.id || null,
          })
          .select('id')
          .single();

        if (error) throw error;

        await recordAuditLog({
          action: 'INVENTORY_SESSION_CREATED',
          entityType: 'inventory_sessions',
          entityId: data.id,
          summary: `สร้างรอบตรวจนับครุภัณฑ์ ${values.session_code} (${values.name})`,
        });

        toast.success('สร้างรอบตรวจนับครุภัณฑ์ประจำปีสำเร็จ');
        setSelectedSessionId(data.id);
      }

      setIsSessionModalOpen(false);
      setEditingSession(null);
      reset();
      queryClient.invalidateQueries({ queryKey: ['inventory-sessions'] });
    } catch (err) {
      toast.error(translateSupabaseError(err));
    }
  };

  const handleConfirmDeleteSession = async () => {
    if (!deletingSession) return;
    try {
      assertSupabaseConfigured();
      const { error } = await supabase
        .from('inventory_sessions')
        .delete()
        .eq('id', deletingSession.id);
      if (error) throw error;

      await recordAuditLog({
        action: 'INVENTORY_SESSION_DELETED',
        entityType: 'inventory_sessions',
        entityId: deletingSession.id,
        summary: `ลบรอบตรวจนับครุภัณฑ์ ${deletingSession.session_code} (${deletingSession.name})`,
      });

      toast.success(`ลบรอบตรวจนับ "${deletingSession.session_code}" สำเร็จ`);
      if (selectedSessionId === deletingSession.id) {
        setSelectedSessionId('');
      }
      setDeletingSession(null);
      queryClient.invalidateQueries({ queryKey: ['inventory-sessions'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-items'] });
    } catch (err) {
      toast.error(translateSupabaseError(err));
    }
  };

  const handleConfirmDeleteItem = async () => {
    if (!deletingItem || !activeSession) return;
    try {
      assertSupabaseConfigured();
      const { error } = await supabase
        .from('inventory_items')
        .delete()
        .eq('id', deletingItem.id);
      if (error) throw error;

      await recordAuditLog({
        action: 'INVENTORY_ITEM_DELETED',
        entityType: 'inventory_items',
        entityId: deletingItem.id,
        summary: `ลบรายการผลตรวจนับของครุภัณฑ์ ${deletingItem.asset?.asset_code || deletingItem.asset_id}`,
      });

      toast.success('ลบรายการผลตรวจนับเรียบร้อยแล้ว');
      setDeletingItem(null);
      queryClient.invalidateQueries({ queryKey: ['inventory-items', activeSession.id] });
    } catch (err) {
      toast.error(translateSupabaseError(err));
    }
  };

  // ค้นหาจากรหัสสแกนหรือเลขครุภัณฑ์เพื่อเลือกครุภัณฑ์อัตโนมัติ
  const handleLookupByCode = () => {
    const q = scanCode.trim().toLowerCase();
    if (!q) return;

    const matched = assets.find(
      (a) =>
        a.asset_code.toLowerCase() === q ||
        a.id.toLowerCase() === q ||
        (a.serial_number || '').toLowerCase() === q
    );

    if (matched) {
      setSelectedAssetId(matched.id);
      setActualLocationId(matched.location_id || '');
      toast.success(`เลือกครุภัณฑ์: ${matched.asset_code} - ${matched.name}`);
    } else {
      toast.error(`ไม่พบครุภัณฑ์รหัส "${scanCode}"`);
    }
  };

  const handleRecordInspection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeSession) {
      toast.error('กรุณาเลือกหรือสร้างรอบตรวจนับก่อน');
      return;
    }
    if (!selectedAssetId) {
      toast.error('กรุณาเลือกครุภัณฑ์ที่ต้องการบันทึกผลตรวจนับ');
      return;
    }

    setIsSavingItem(true);
    try {
      assertSupabaseConfigured();
      const targetAsset = assets.find((a) => a.id === selectedAssetId);
      const existingRecord = sessionItems.find((i) => i.asset_id === selectedAssetId);

      // ป้องกันการบันทึกซ้ำโดยไม่ตั้งใจ แต่ให้แก้ไขอัปเดตได้ตามสิทธิ์
      const payload = {
        session_id: activeSession.id,
        asset_id: selectedAssetId,
        expected_location_id: targetAsset?.location_id || null,
        actual_location_id: actualLocationId || targetAsset?.location_id || null,
        result_status: resultStatus,
        inspected_by: user?.id || null,
        inspected_at: new Date().toISOString(),
        notes: itemNotes.trim() || null,
      };

      const { error } = await supabase
        .from('inventory_items')
        .upsert(payload, { onConflict: 'session_id,asset_id' });

      if (error) throw error;

      await recordAuditLog({
        action: existingRecord ? 'INVENTORY_ITEM_UPDATED' : 'INVENTORY_ITEM_RECORDED',
        entityType: 'inventory_items',
        entityId: selectedAssetId,
        summary: `${existingRecord ? 'ปรับปรุง' : 'บันทึก'}ผลตรวจนับครุภัณฑ์ ${
          targetAsset?.asset_code || ''
        } เป็น "${INVENTORY_RESULT_META[resultStatus].label}"`,
      });

      toast.success(
        existingRecord
          ? `อัปเดตผลตรวจนับของ ${targetAsset?.asset_code} เรียบร้อยแล้ว`
          : `บันทึกผลตรวจนับของ ${targetAsset?.asset_code} สำเร็จ`
      );

      setScanCode('');
      setSelectedAssetId('');
      setItemNotes('');
      queryClient.invalidateQueries({ queryKey: ['inventory-items', activeSession.id] });
    } catch (err) {
      toast.error(translateSupabaseError(err));
    } finally {
      setIsSavingItem(false);
    }
  };

  const handleExportSessionReport = async (format: 'xlsx' | 'pdf') => {
    if (!activeSession || sessionItems.length === 0) {
      toast.error('ยังไม่มีรายการผลตรวจนับในรอบนี้ให้ส่งออก');
      return;
    }

    const rows = sessionItems.map((item, idx) => ({
      seq: idx + 1,
      asset_code: item.asset?.asset_code || '-',
      asset_name: item.asset?.name || '-',
      expected_location: item.expected_location
        ? `${item.expected_location.building} ${item.expected_location.room || ''}`.trim()
        : '-',
      actual_location: item.actual_location
        ? `${item.actual_location.building} ${item.actual_location.room || ''}`.trim()
        : '-',
      result_status: INVENTORY_RESULT_META[item.result_status]?.label || item.result_status,
      inspector: item.inspector?.full_name || '-',
      inspected_at: formatThaiDateTime(item.inspected_at),
      notes: item.notes || '-',
    }));

    const cols: { key: keyof (typeof rows)[0]; header: string }[] = [
      { key: 'seq', header: 'ลำดับ' },
      { key: 'asset_code', header: 'เลขครุภัณฑ์' },
      { key: 'asset_name', header: 'ชื่อครุภัณฑ์' },
      { key: 'expected_location', header: 'สถานที่ตามทะเบียน' },
      { key: 'actual_location', header: 'สถานที่พบจริง' },
      { key: 'result_status', header: 'ผลการตรวจนับ' },
      { key: 'inspector', header: 'ผู้ตรวจนับ' },
      { key: 'inspected_at', header: 'วันเวลาตรวจนับ' },
      { key: 'notes', header: 'หมายเหตุ' },
    ];

    const meta = {
      reportTitle: `รายงานผลการตรวจนับครุภัณฑ์ประจำปี: ${activeSession.session_code} (${activeSession.name})`,
      orgName: settings?.org_name,
      filtersSummary: `ปีงบประมาณ ${activeSession.fiscal_year} | ตรวจแล้ว ${sessionItems.length} รายการ`,
      fileNamePrefix: `inventory_${activeSession.session_code}`,
    };

    if (format === 'xlsx') {
      exportToExcel(rows, cols, meta);
      toast.success('ส่งออกรายงานตรวจนับ Excel สำเร็จ');
    } else {
      await exportToPDF(rows, cols, meta);
      toast.success('ส่งออกรายงานตรวจนับ PDF (ภาษาไทย) สำเร็จ');
    }
  };

  // สรุปผลตรวจนับ
  const summaryCounts = useMemo(() => {
    return {
      totalTarget: assets.length,
      inspected: sessionItems.length,
      found_normal: sessionItems.filter((i) => i.result_status === 'found_normal').length,
      not_found: sessionItems.filter((i) => i.result_status === 'not_found').length,
      found_mismatch: sessionItems.filter((i) => i.result_status === 'found_mismatch').length,
      damaged: sessionItems.filter((i) => i.result_status === 'damaged').length,
      needs_review: sessionItems.filter((i) => i.result_status === 'needs_review').length,
    };
  }, [assets.length, sessionItems]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="ตรวจนับครุภัณฑ์ประจำปี (Annual Inventory Verification)"
        subtitle="สร้างรอบตรวจนับประจำปีงบประมาณ บันทึกผลจากการสแกน QR/Barcode และออกรายงานสรุปผลตรวจนับ"
        actions={
          <>
            <button
              type="button"
              onClick={() => handleExportSessionReport('xlsx')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
              Export Excel
            </button>
            <button
              type="button"
              onClick={() => handleExportSessionReport('pdf')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              <FileText className="h-4 w-4 text-rose-600" />
              Export PDF
            </button>
            {canManage && (
              <button
                type="button"
                onClick={openCreateSessionModal}
                className="inline-flex items-center gap-1.5 rounded-lg bg-gov-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-gov-800"
              >
                <Plus className="h-4 w-4" />
                สร้างรอบตรวจนับใหม่
              </button>
            )}
          </>
        }
      />

      {loadingSessions ? (
        <LoadingState message="กำลังโหลดรอบการตรวจนับครุภัณฑ์..." />
      ) : sessions.length === 0 ? (
        <EmptyState
          title="ยังไม่มีรอบการตรวจนับครุภัณฑ์"
          description="เริ่มต้นสร้างรอบการตรวจนับประจำปีงบประมาณเพื่อบันทึกผลการตรวจสอบสภาพครุภัณฑ์"
          action={
            canManage && (
              <button
                type="button"
                onClick={() => setIsSessionModalOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-gov-700 px-4 py-2 text-xs font-semibold text-white hover:bg-gov-800"
              >
                <Plus className="h-4 w-4" />
                สร้างรอบตรวจนับรอบแรก
              </button>
            )
          }
        />
      ) : (
        <>
          {/* แถบเลือกรอบตรวจนับและสรุปความคืบหน้า */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <ClipboardCheck className="h-6 w-6 text-gov-700" />
                <div>
                  <label className="block text-xs font-semibold text-slate-500">
                    เลือกรอบการตรวจนับครุภัณฑ์:
                  </label>
                  <select
                    value={activeSession?.id || ''}
                    onChange={(e) => setSelectedSessionId(e.target.value)}
                    className="mt-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-900"
                  >
                    {sessions.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.session_code} — {s.name} (ปีงบประมาณ {s.fiscal_year})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {activeSession && (
                <div className="flex flex-wrap items-center gap-3">
                  <div className="text-xs text-slate-600">
                    ช่วงเวลาตรวจนับ: <strong>{formatThaiDate(activeSession.start_date)}</strong> ถึง{' '}
                    <strong>{formatThaiDate(activeSession.end_date)}</strong>
                  </div>
                  {canManage && (
                    <div className="inline-flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => openEditSessionModal(activeSession)}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                        title="แก้ไขรอบตรวจนับนี้"
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                        แก้ไขรอบ
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeletingSession(activeSession)}
                        className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-100"
                        title="ลบรอบตรวจนับนี้"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        ลบรอบ
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* สรุปตัวเลขผลการตรวจนับ */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-6 text-center">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-[11px] text-slate-500">ตรวจแล้ว / ทั้งหมด</p>
                <p className="mt-1 text-base font-bold text-slate-900">
                  {summaryCounts.inspected} / {summaryCounts.totalTarget}
                </p>
              </div>
              <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3">
                <p className="text-[11px] text-emerald-800">พบตามปกติ</p>
                <p className="mt-1 text-base font-bold text-emerald-700">
                  {summaryCounts.found_normal}
                </p>
              </div>
              <div className="rounded-lg border border-rose-200 bg-rose-50/60 p-3">
                <p className="text-[11px] text-rose-800">ไม่พบครุภัณฑ์</p>
                <p className="mt-1 text-base font-bold text-rose-700">{summaryCounts.not_found}</p>
              </div>
              <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3">
                <p className="text-[11px] text-amber-800">พบแต่ข้อมูลไม่ตรง</p>
                <p className="mt-1 text-base font-bold text-amber-700">
                  {summaryCounts.found_mismatch}
                </p>
              </div>
              <div className="rounded-lg border border-orange-200 bg-orange-50/60 p-3">
                <p className="text-[11px] text-orange-800">พบแต่ชำรุด</p>
                <p className="mt-1 text-base font-bold text-orange-700">{summaryCounts.damaged}</p>
              </div>
              <div className="rounded-lg border border-purple-200 bg-purple-50/60 p-3">
                <p className="text-[11px] text-purple-800">รอตรวจสอบเพิ่ม</p>
                <p className="mt-1 text-base font-bold text-purple-700">
                  {summaryCounts.needs_review}
                </p>
              </div>
            </div>
          </div>

          {/* ฟอร์มบันทึกผลตรวจนับ */}
          {canManage && (
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs space-y-4">
              <h2 className="text-base font-bold text-slate-900">
                บันทึกผลการตรวจนับรายครุภัณฑ์ (รองรับเครื่องสแกน QR / Barcode)
              </h2>

              <form onSubmit={handleRecordInspection} className="space-y-4">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700">
                      1. สแกนหรือกรอกเลขครุภัณฑ์เพื่อค้นหาเร็ว
                    </label>
                    <div className="mt-1 flex gap-1.5">
                      <div className="relative flex-1">
                        <QrCode className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                        <input
                          type="text"
                          value={scanCode}
                          onChange={(e) => setScanCode(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleLookupByCode();
                            }
                          }}
                          placeholder="ยิง Barcode หรือพิมพ์เลขครุภัณฑ์..."
                          className="w-full rounded-lg border border-slate-300 py-1.5 pl-8 pr-2 text-xs font-mono"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={handleLookupByCode}
                        className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-900"
                      >
                        ค้นหา
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700">
                      2. เลือกครุภัณฑ์ <span className="text-rose-600">*</span>
                    </label>
                    <select
                      value={selectedAssetId}
                      onChange={(e) => {
                        const id = e.target.value;
                        setSelectedAssetId(id);
                        const found = assets.find((a) => a.id === id);
                        if (found) setActualLocationId(found.location_id || '');
                      }}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs"
                    >
                      <option value="">-- เลือกครุภัณฑ์จากทะเบียน --</option>
                      {assets.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.asset_code} — {a.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700">
                      3. สถานะผลการตรวจนับ <span className="text-rose-600">*</span>
                    </label>
                    <select
                      value={resultStatus}
                      onChange={(e) => setResultStatus(e.target.value as InventoryResultStatus)}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold"
                    >
                      {Object.entries(INVENTORY_RESULT_META).map(([key, meta]) => (
                        <option key={key} value={key}>
                          {meta.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700">
                      สถานที่พบจริงขณะตรวจนับ
                    </label>
                    <select
                      value={actualLocationId}
                      onChange={(e) => setActualLocationId(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs"
                    >
                      <option value="">-- ไม่ระบุสถานที่ --</option>
                      {locations.map((loc) => (
                        <option key={loc.id} value={loc.id}>
                          {loc.building} ห้อง {loc.room || '-'} ({loc.name})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="md:col-span-2 flex items-end gap-2">
                    <div className="flex-1">
                      <label className="block text-xs font-semibold text-slate-700">
                        หมายเหตุ / สภาพครุภัณฑ์ที่พบ
                      </label>
                      <input
                        type="text"
                        value={itemNotes}
                        onChange={(e) => setItemNotes(e.target.value)}
                        placeholder="ระบุหมายเหตุเพิ่มเติม เช่น ป้ายฉลากซีดจาง หรือย้ายห้องชั่วคราว..."
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={isSavingItem}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-gov-700 px-4 py-2 text-xs font-semibold text-white hover:bg-gov-800 disabled:opacity-50"
                    >
                      {isSavingItem ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4" />
                      )}
                      บันทึกผลตรวจนับ
                    </button>
                  </div>
                </div>
              </form>
            </div>
          )}

          {/* ตารางผลการตรวจนับ */}
          <div className="rounded-xl border border-slate-200 bg-white shadow-2xs overflow-hidden">
            <div className="border-b border-slate-200 px-6 py-4">
              <h3 className="text-sm font-bold text-slate-900">
                รายการครุภัณฑ์ที่บันทึกผลตรวจนับแล้ว ({sessionItems.length} รายการ)
              </h3>
            </div>

            {loadingItems ? (
              <LoadingState message="กำลังโหลดผลการตรวจนับ..." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs font-semibold text-slate-600 border-b border-slate-200">
                    <tr>
                      <th className="p-3">เลขครุภัณฑ์</th>
                      <th className="p-3">ชื่อครุภัณฑ์</th>
                      <th className="p-3">สถานที่ตามทะเบียน</th>
                      <th className="p-3">สถานที่พบจริง</th>
                      <th className="p-3">ผลการตรวจนับ</th>
                      <th className="p-3">ผู้ตรวจนับ / เวลา</th>
                      <th className="p-3">หมายเหตุ</th>
                      {canManage && <th className="p-3 text-right">จัดการ</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-xs">
                    {sessionItems.length === 0 ? (
                      <tr>
                        <td colSpan={canManage ? 8 : 7} className="p-8 text-center text-slate-400">
                          ยังไม่มีการบันทึกผลตรวจนับในรอบนี้
                        </td>
                      </tr>
                    ) : (
                      sessionItems.map((item) => (
                        <tr key={item.id} className="hover:bg-slate-50">
                          <td className="p-3 font-mono font-semibold text-gov-700">
                            {item.asset?.asset_code || '-'}
                          </td>
                          <td className="p-3 font-medium text-slate-900">
                            {item.asset?.name || '-'}
                          </td>
                          <td className="p-3 text-slate-600">
                            {item.expected_location
                              ? `${item.expected_location.building} ห้อง ${item.expected_location.room || '-'}`
                              : '-'}
                          </td>
                          <td className="p-3 text-slate-600">
                            {item.actual_location
                              ? `${item.actual_location.building} ห้อง ${item.actual_location.room || '-'}`
                              : '-'}
                          </td>
                          <td className="p-3">
                            <StatusBadge
                              label={INVENTORY_RESULT_META[item.result_status]?.label || item.result_status}
                              className={INVENTORY_RESULT_META[item.result_status]?.badgeClass}
                            />
                          </td>
                          <td className="p-3 text-slate-600">
                            <p>{item.inspector?.full_name || '-'}</p>
                            <p className="text-[11px] text-slate-400">
                              {formatThaiDateTime(item.inspected_at)}
                            </p>
                          </td>
                          <td className="p-3 text-slate-600">{item.notes || '-'}</td>
                          {canManage && (
                            <td className="p-3 text-right whitespace-nowrap">
                              <div className="inline-flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedAssetId(item.asset_id);
                                    setResultStatus(item.result_status);
                                    setActualLocationId(item.actual_location_id || '');
                                    setItemNotes(item.notes || '');
                                    toast.info(`ดึงข้อมูล ${item.asset?.asset_code || ''} ขึ้นฟอร์มแก้ไขด้านบนแล้ว`);
                                  }}
                                  className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100"
                                  title="แก้ไขผลตรวจนับ"
                                >
                                  <Edit3 className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setDeletingItem(item)}
                                  className="rounded-md p-1.5 text-rose-600 hover:bg-rose-50"
                                  title="ลบรายการตรวจนับ"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </td>
                          )}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* Modal สร้าง/แก้ไขรอบตรวจนับ */}
      <Modal
        open={isSessionModalOpen}
        onClose={() => {
          setIsSessionModalOpen(false);
          setEditingSession(null);
        }}
        title={editingSession ? 'แก้ไขรอบการตรวจนับครุภัณฑ์' : 'สร้างรอบการตรวจนับครุภัณฑ์ประจำปี'}
        description="กำหนดรหัสรอบ ปีงบประมาณ ช่วงเวลา และผู้รับผิดชอบการตรวจนับ"
      >
        <form onSubmit={handleSubmit(onCreateSession)} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-slate-700">
                รหัสรอบตรวจนับ <span className="text-rose-600">*</span>
              </label>
              <input
                type="text"
                {...register('session_code')}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
              />
              {errors.session_code && (
                <p className="mt-1 text-xs text-rose-600">{errors.session_code.message}</p>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">
                ปีงบประมาณ (พ.ศ.) <span className="text-rose-600">*</span>
              </label>
              <input
                type="number"
                {...register('fiscal_year')}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700">
              ชื่อรอบการตรวจนับ <span className="text-rose-600">*</span>
            </label>
            <input
              type="text"
              {...register('name')}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
            {errors.name && <p className="mt-1 text-xs text-rose-600">{errors.name.message}</p>}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-slate-700">วันเริ่มต้นตรวจนับ</label>
              <input
                type="date"
                {...register('start_date')}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">วันสิ้นสุดตรวจนับ</label>
              <input
                type="date"
                {...register('end_date')}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">
                ขอบเขตหน่วยงาน (เว้นว่างหากตรวจทั้งองค์กร)
              </label>
              <select
                {...register('department_id')}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                <option value="">-- ทุกหน่วยงานในสังกัด --</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.code} - {d.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">ประธาน/ผู้รับผิดชอบหลัก</label>
              <select
                {...register('responsible_id')}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                <option value="">-- ระบุผู้รับผิดชอบ --</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700">หมายเหตุ / เลขคำสั่งแต่งตั้งคณะกรรมการ</label>
            <textarea
              rows={2}
              {...register('notes')}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
            <button
              type="button"
              onClick={() => {
                setIsSessionModalOpen(false);
                setEditingSession(null);
              }}
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
              {editingSession ? 'บันทึกการแก้ไข' : 'สร้างรอบตรวจนับ'}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(deletingSession)}
        onClose={() => setDeletingSession(null)}
        onConfirm={handleConfirmDeleteSession}
        title="ยืนยันการลบรอบตรวจนับ"
        description={`คุณต้องการลบรอบตรวจนับ "${deletingSession?.session_code} — ${deletingSession?.name}" พร้อมรายการตรวจนับทั้งหมดในรอบนี้ใช่หรือไม่?`}
        confirmLabel="ยืนยันลบรอบตรวจนับ"
      />

      <ConfirmDialog
        open={Boolean(deletingItem)}
        onClose={() => setDeletingItem(null)}
        onConfirm={handleConfirmDeleteItem}
        title="ยืนยันการลบรายการผลตรวจนับ"
        description={`คุณต้องการลบผลการตรวจนับของครุภัณฑ์ "${deletingItem?.asset?.asset_code || ''} — ${deletingItem?.asset?.name || ''}" ใช่หรือไม่?`}
        confirmLabel="ยืนยันลบรายการ"
      />
    </div>
  );
}
