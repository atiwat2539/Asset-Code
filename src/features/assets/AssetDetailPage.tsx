import React, { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';
import { toast } from 'sonner';
import {
  ArrowLeft,
  QrCode,
  FileText,
  Upload,
  ExternalLink,
  Trash2,
  Package,
  ArrowLeftRight,
  Repeat,
  Wrench,
  ClipboardCheck,
  History,
  Paperclip,
  Loader2,
} from 'lucide-react';
import { assertSupabaseConfigured, isSupabaseConfigured, recordAuditLog, supabase } from '@/lib/supabase';
import {
  ASSET_STATUS_META,
  BORROW_STATUS_META,
  formatCurrency,
  INVENTORY_RESULT_META,
  MAINTENANCE_STATUS_META,
  TRANSFER_STATUS_META,
  translateSupabaseError,
} from '@/lib/utils';
import { formatThaiDate, formatThaiDateTime } from '@/lib/date';
import { getSignedFileUrl, uploadFileToBucket, type StorageBucketName } from '@/lib/storage';
import { useAuth } from '@/features/auth/AuthContext';
import { ConfirmDialog, ErrorState, LoadingState, StatusBadge } from '@/components/ui/common';
import type {
  Asset,
  AssetAttachment,
  AssetTransfer,
  AuditLog,
  BorrowRequest,
  InventoryItem,
  MaintenanceRequest,
} from '@/types/database';

type TabKey =
  | 'general'
  | 'transfers'
  | 'borrowing'
  | 'maintenance'
  | 'inventory'
  | 'attachments'
  | 'audit';

export function AssetDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user, hasRole } = useAuth();
  const canEdit = hasRole(['admin', 'asset_officer']);
  const queryClient = useQueryClient();
  const configured = isSupabaseConfigured();

  const [activeTab, setActiveTab] = useState<TabKey>('general');
  const [uploadingFile, setUploadingFile] = useState(false);
  const [attachmentToDelete, setAttachmentToDelete] = useState<AssetAttachment | null>(null);

  const {
    data: detail,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['asset-detail', id],
    queryFn: async () => {
      if (!configured || !id) return null;

      const [
        assetRes,
        transfersRes,
        borrowsRes,
        maintenanceRes,
        inventoryRes,
        attachmentsRes,
        auditRes,
      ] = await Promise.all([
        supabase
          .from('assets')
          .select(
            '*, category:asset_categories(*), department:departments(*), location:locations(*), custodian:profiles!assets_custodian_id_fkey(*)'
          )
          .eq('id', id)
          .maybeSingle(),
        supabase
          .from('asset_transfers')
          .select(
            '*, from_department:departments!asset_transfers_from_department_id_fkey(name), to_department:departments!asset_transfers_to_department_id_fkey(name), from_location:locations!asset_transfers_from_location_id_fkey(name, building, room), to_location:locations!asset_transfers_to_location_id_fkey(name, building, room), from_custodian:profiles!asset_transfers_from_custodian_id_fkey(full_name), to_custodian:profiles!asset_transfers_to_custodian_id_fkey(full_name)'
          )
          .eq('asset_id', id)
          .order('created_at', { ascending: false }),
        supabase
          .from('borrow_requests')
          .select('*, requester:profiles!borrow_requests_requester_id_fkey(full_name, email)')
          .eq('asset_id', id)
          .order('created_at', { ascending: false }),
        supabase
          .from('maintenance_requests')
          .select('*, reporter:profiles!maintenance_requests_reported_by_fkey(full_name)')
          .eq('asset_id', id)
          .order('created_at', { ascending: false }),
        supabase
          .from('inventory_items')
          .select(
            '*, session:inventory_sessions(session_code, name, fiscal_year), actual_location:locations!inventory_items_actual_location_id_fkey(name, building, room), inspector:profiles!inventory_items_inspected_by_fkey(full_name)'
          )
          .eq('asset_id', id)
          .order('inspected_at', { ascending: false }),
        supabase
          .from('asset_attachments')
          .select('*')
          .eq('asset_id', id)
          .order('created_at', { ascending: false }),
        supabase
          .from('audit_logs')
          .select('*')
          .eq('entity_id', id)
          .order('created_at', { ascending: false })
          .limit(50),
      ]);

      if (assetRes.error) throw assetRes.error;
      if (!assetRes.data) throw new Error('ไม่พบข้อมูลครุภัณฑ์ที่ระบุ');

      return {
        asset: assetRes.data as Asset,
        transfers: (transfersRes.data || []) as AssetTransfer[],
        borrows: (borrowsRes.data || []) as BorrowRequest[],
        maintenances: (maintenanceRes.data || []) as MaintenanceRequest[],
        inventories: (inventoryRes.data || []) as (InventoryItem & {
          session?: { session_code: string; name: string; fiscal_year: number };
        })[],
        attachments: (attachmentsRes.data || []) as AssetAttachment[],
        audits: (auditRes.data || []) as AuditLog[],
      };
    },
  });

  const handleUploadAttachment = async (
    e: React.ChangeEvent<HTMLInputElement>,
    category: 'image' | 'procurement' | 'inspection' | 'manual'
  ) => {
    const file = e.target.files?.[0];
    if (!file || !id) return;

    setUploadingFile(true);
    try {
      assertSupabaseConfigured();
      const bucket: StorageBucketName = category === 'image' ? 'asset-images' : 'asset-documents';
      const uploaded = await uploadFileToBucket({
        bucket,
        folder: id,
        file,
      });

      const { error: insertErr } = await supabase.from('asset_attachments').insert({
        asset_id: id,
        file_name: file.name,
        file_path: uploaded.path,
        file_type: file.type,
        file_size: file.size,
        bucket_name: bucket,
        category,
        uploaded_by: user?.id || null,
      });

      if (insertErr) throw insertErr;

      if (category === 'image' && uploaded.publicUrl) {
        await supabase.from('assets').update({ image_url: uploaded.publicUrl }).eq('id', id);
      }

      await recordAuditLog({
        action: 'ATTACHMENT_UPLOADED',
        entityType: 'assets',
        entityId: id,
        summary: `อัปโหลดไฟล์แนบ ${file.name} (${category})`,
      });

      toast.success('อัปโหลดไฟล์แนบเรียบร้อยแล้ว');
      queryClient.invalidateQueries({ queryKey: ['asset-detail', id] });
    } catch (err) {
      toast.error(translateSupabaseError(err));
    } finally {
      setUploadingFile(false);
      e.target.value = '';
    }
  };

  const handleOpenAttachment = async (att: AssetAttachment) => {
    try {
      const signedUrl = await getSignedFileUrl(att.bucket_name, att.file_path, 300);
      window.open(signedUrl, '_blank', 'noopener,noreferrer');
    } catch (err) {
      toast.error(translateSupabaseError(err));
    }
  };

  const confirmDeleteAttachment = async () => {
    if (!attachmentToDelete || !id) return;
    try {
      await supabase.storage
        .from(attachmentToDelete.bucket_name)
        .remove([attachmentToDelete.file_path]);
      const { error: delErr } = await supabase
        .from('asset_attachments')
        .delete()
        .eq('id', attachmentToDelete.id);
      if (delErr) throw delErr;

      toast.success('ลบไฟล์แนบเรียบร้อยแล้ว');
      setAttachmentToDelete(null);
      queryClient.invalidateQueries({ queryKey: ['asset-detail', id] });
    } catch (err) {
      toast.error(translateSupabaseError(err));
    }
  };

  if (isLoading) {
    return <LoadingState message="กำลังโหลดข้อมูลรายละเอียดครุภัณฑ์..." />;
  }

  if (error || !detail) {
    return <ErrorState message={translateSupabaseError(error)} onRetry={() => refetch()} />;
  }

  const { asset, transfers, borrows, maintenances, inventories, attachments, audits } = detail;
  const statusMeta = ASSET_STATUS_META[asset.status];
  const totalMaintenanceCost = maintenances.reduce(
    (sum, m) => sum + Number(m.actual_cost || 0),
    0
  );

  const tabs: { key: TabKey; label: string; count?: number; icon: React.ComponentType<{ className?: string }> }[] = [
    { key: 'general', label: 'ข้อมูลทั่วไป', icon: Package },
    { key: 'transfers', label: 'ประวัติโอนย้ายสถานที่/ผู้รับผิดชอบ', count: transfers.length, icon: ArrowLeftRight },
    { key: 'borrowing', label: 'ประวัติการยืม-คืน', count: borrows.length, icon: Repeat },
    { key: 'maintenance', label: 'ประวัติการซ่อมบำรุง', count: maintenances.length, icon: Wrench },
    { key: 'inventory', label: 'ประวัติการตรวจนับ', count: inventories.length, icon: ClipboardCheck },
    { key: 'attachments', label: 'เอกสารและรูปภาพ', count: attachments.length, icon: Paperclip },
    { key: 'audit', label: 'Audit Log', count: audits.length, icon: History },
  ];

  // ข้อมูลที่บรรจุใน QR Code ใช้เฉพาะรหัสอ้างอิงครุภัณฑ์ ไม่เก็บข้อมูลส่วนบุคคล
  const qrPayload = `${window.location.origin}/assets/${asset.id}`;

  return (
    <div className="space-y-6">
      {/* Top Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Link
            to="/assets"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <ArrowLeft className="h-4 w-4" />
            กลับทะเบียนครุภัณฑ์
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm font-bold text-gov-700">{asset.asset_code}</span>
              <StatusBadge
                label={statusMeta?.label || asset.status}
                className={statusMeta?.badgeClass}
                dotClass={statusMeta?.dotClass}
              />
            </div>
            <h1 className="text-lg font-bold text-slate-900 sm:text-xl">{asset.name}</h1>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link
            to={`/qr-barcode?assetId=${asset.id}`}
            className="inline-flex items-center gap-1.5 rounded-lg bg-gov-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-gov-800"
          >
            <QrCode className="h-4 w-4" />
            พิมพ์ฉลาก QR / Barcode
          </Link>
        </div>
      </div>

      {/* Tabs Navigation */}
      <div className="border-b border-slate-200 bg-white rounded-t-xl px-4 pt-2 shadow-2xs overflow-x-auto">
        <nav className="flex space-x-2 min-w-max">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`inline-flex items-center gap-2 border-b-2 px-3.5 py-3 text-xs font-semibold transition ${
                  isActive
                    ? 'border-gov-700 text-gov-700'
                    : 'border-transparent text-slate-600 hover:border-slate-300 hover:text-slate-900'
                }`}
              >
                <Icon className="h-4 w-4" />
                <span>{tab.label}</span>
                {tab.count !== undefined && (
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] ${
                      isActive ? 'bg-gov-100 text-gov-800' : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {tab.count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tab Content */}
      <div className="rounded-b-xl border border-t-0 border-slate-200 bg-white p-6 shadow-2xs">
        {activeTab === 'general' && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2 space-y-6">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 text-sm">
                <div className="rounded-lg border border-slate-200 p-3.5">
                  <p className="text-xs text-slate-500">เลขครุภัณฑ์</p>
                  <p className="mt-1 font-mono font-bold text-slate-900">{asset.asset_code}</p>
                </div>
                <div className="rounded-lg border border-slate-200 p-3.5">
                  <p className="text-xs text-slate-500">ประเภท / หมวดหมู่</p>
                  <p className="mt-1 font-semibold text-slate-900">
                    {asset.category ? `${asset.category.code} - ${asset.category.name}` : '-'}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 p-3.5">
                  <p className="text-xs text-slate-500">ยี่ห้อ / รุ่น</p>
                  <p className="mt-1 font-semibold text-slate-900">
                    {[asset.brand, asset.model].filter(Boolean).join(' / ') || '-'}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 p-3.5">
                  <p className="text-xs text-slate-500">หมายเลขเครื่อง (Serial Number)</p>
                  <p className="mt-1 font-mono font-semibold text-slate-900">
                    {asset.serial_number || '-'}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 p-3.5">
                  <p className="text-xs text-slate-500">ราคาต่อหน่วย (ราคาทุน)</p>
                  <p className="mt-1 font-bold text-emerald-700">{formatCurrency(asset.unit_price)}</p>
                </div>
                <div className="rounded-lg border border-slate-200 p-3.5">
                  <p className="text-xs text-slate-500">วันที่รับเข้า / วันที่ตรวจรับ</p>
                  <p className="mt-1 font-semibold text-slate-900">
                    {formatThaiDate(asset.acquired_date)}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 p-3.5">
                  <p className="text-xs text-slate-500">เลขที่สัญญาจัดซื้อ / เอกสาร</p>
                  <p className="mt-1 font-semibold text-slate-900">
                    {asset.contract_number || '-'}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 p-3.5">
                  <p className="text-xs text-slate-500">อายุการใช้งานโดยประมาณ</p>
                  <p className="mt-1 font-semibold text-slate-900">
                    {asset.useful_life_years ? `${asset.useful_life_years} ปี` : '-'}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 p-3.5">
                  <p className="text-xs text-slate-500">หน่วยงานผู้ครอบครอง</p>
                  <p className="mt-1 font-semibold text-slate-900">
                    {asset.department ? `${asset.department.code} - ${asset.department.name}` : '-'}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 p-3.5">
                  <p className="text-xs text-slate-500">อาคาร / ห้อง / สถานที่ตั้งปัจจุบัน</p>
                  <p className="mt-1 font-semibold text-slate-900">
                    {asset.location
                      ? `${asset.location.building} ชั้น ${asset.location.floor || '-'} ห้อง ${asset.location.room || '-'} (${asset.location.name})`
                      : '-'}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 p-3.5">
                  <p className="text-xs text-slate-500">ผู้รับผิดชอบดูแลครุภัณฑ์</p>
                  <p className="mt-1 font-semibold text-slate-900">
                    {asset.custodian ? `${asset.custodian.full_name} (${asset.custodian.email})` : '-'}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 p-3.5">
                  <p className="text-xs text-slate-500">ค่าใช้จ่ายซ่อมบำรุงสะสม</p>
                  <p className="mt-1 font-semibold text-amber-700">
                    {formatCurrency(totalMaintenanceCost)} ({maintenances.length} ครั้ง)
                  </p>
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 p-4 text-sm space-y-2">
                <p className="text-xs font-semibold text-slate-500">คุณลักษณะเฉพาะ / รายละเอียด</p>
                <p className="text-slate-800">{asset.description || 'ไม่มีรายละเอียดเพิ่มเติม'}</p>
                {asset.notes && (
                  <p className="text-xs text-slate-500 pt-2 border-t border-slate-100">
                    หมายเหตุ: {asset.notes}
                  </p>
                )}
              </div>
            </div>

            {/* รูปภาพและ QR Code ประจำครุภัณฑ์ */}
            <div className="space-y-4">
              <div className="rounded-xl border border-slate-200 p-4 text-center">
                <p className="text-xs font-semibold text-slate-600 mb-3">รูปภาพครุภัณฑ์</p>
                {asset.image_url ? (
                  <img
                    src={asset.image_url}
                    alt={asset.name}
                    className="mx-auto max-h-56 rounded-lg object-contain border border-slate-200"
                  />
                ) : (
                  <div className="flex h-44 flex-col items-center justify-center rounded-lg bg-slate-50 text-slate-400 border border-dashed border-slate-200">
                    <Package className="h-10 w-10" />
                    <span className="mt-2 text-xs">ยังไม่มีรูปภาพครุภัณฑ์</span>
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-slate-200 p-4 text-center">
                <p className="text-xs font-semibold text-slate-600 mb-3">
                  QR Code สำหรับสแกนตรวจสอบครุภัณฑ์
                </p>
                <div className="inline-block rounded-xl border border-slate-200 bg-white p-3">
                  <QRCodeSVG value={qrPayload} size={140} level="M" />
                </div>
                <p className="mt-2 font-mono text-xs font-bold text-slate-800">{asset.asset_code}</p>
                <p className="text-[11px] text-slate-400">
                  บรรจุเฉพาะลิงก์อ้างอิง Asset ID ไม่เปิดเผยข้อมูลส่วนบุคคล
                </p>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'transfers' && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs font-semibold text-slate-600 border-b border-slate-200">
                <tr>
                  <th className="p-3">เลขที่ใบโอน</th>
                  <th className="p-3">วันที่มีผล</th>
                  <th className="p-3">ต้นทาง (หน่วยงาน / สถานที่ / ผู้ดูแล)</th>
                  <th className="p-3">ปลายทาง (หน่วยงาน / สถานที่ / ผู้ดูแล)</th>
                  <th className="p-3">เหตุผล</th>
                  <th className="p-3">สถานะ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {transfers.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-slate-400">
                      ยังไม่มีประวัติการโอนย้ายสถานที่หรือผู้รับผิดชอบสำหรับครุภัณฑ์นี้
                    </td>
                  </tr>
                ) : (
                  transfers.map((tr) => (
                    <tr key={tr.id}>
                      <td className="p-3 font-mono font-semibold text-gov-700">{tr.transfer_no}</td>
                      <td className="p-3">{formatThaiDate(tr.effective_date)}</td>
                      <td className="p-3">
                        <p className="font-medium">{tr.from_department?.name || '-'}</p>
                        <p className="text-slate-500">
                          {tr.from_location?.name || '-'} &bull; {tr.from_custodian?.full_name || '-'}
                        </p>
                      </td>
                      <td className="p-3">
                        <p className="font-medium text-emerald-800">{tr.to_department?.name || '-'}</p>
                        <p className="text-slate-500">
                          {tr.to_location?.name || '-'} &bull; {tr.to_custodian?.full_name || '-'}
                        </p>
                      </td>
                      <td className="p-3">{tr.reason}</td>
                      <td className="p-3">
                        <StatusBadge
                          label={TRANSFER_STATUS_META[tr.status]?.label || tr.status}
                          className={TRANSFER_STATUS_META[tr.status]?.badgeClass}
                        />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'borrowing' && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs font-semibold text-slate-600 border-b border-slate-200">
                <tr>
                  <th className="p-3">เลขที่คำขอยืม</th>
                  <th className="p-3">ผู้ขอยืม</th>
                  <th className="p-3">วัตถุประสงค์</th>
                  <th className="p-3">วันที่ยืม - กำหนดคืน</th>
                  <th className="p-3">วันที่คืนจริง</th>
                  <th className="p-3">สถานะ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {borrows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-slate-400">
                      ยังไม่มีประวัติการยืม-คืนสำหรับครุภัณฑ์นี้
                    </td>
                  </tr>
                ) : (
                  borrows.map((br) => (
                    <tr key={br.id}>
                      <td className="p-3 font-mono font-semibold text-gov-700">{br.request_no}</td>
                      <td className="p-3">{br.requester?.full_name || '-'}</td>
                      <td className="p-3">{br.purpose}</td>
                      <td className="p-3">
                        {formatThaiDate(br.borrow_date)} &rarr; {formatThaiDate(br.expected_return_date)}
                      </td>
                      <td className="p-3">
                        {br.actual_return_date ? formatThaiDateTime(br.actual_return_date) : '-'}
                      </td>
                      <td className="p-3">
                        <StatusBadge
                          label={BORROW_STATUS_META[br.status]?.label || br.status}
                          className={BORROW_STATUS_META[br.status]?.badgeClass}
                        />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'maintenance' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-lg bg-amber-50 p-3 text-xs text-amber-900 border border-amber-200">
              <span>จำนวนการส่งซ่อมทั้งหมด: <strong>{maintenances.length} ครั้ง</strong></span>
              <span>ค่าใช้จ่ายซ่อมบำรุงสะสมรวม: <strong>{formatCurrency(totalMaintenanceCost)}</strong></span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs font-semibold text-slate-600 border-b border-slate-200">
                  <tr>
                    <th className="p-3">เลขที่ใบแจ้งซ่อม</th>
                    <th className="p-3">วันที่แจ้ง</th>
                    <th className="p-3">อาการชำรุด / ปัญหา</th>
                    <th className="p-3">ผู้ให้บริการซ่อม</th>
                    <th className="p-3 text-right">ค่าใช้จ่ายจริง</th>
                    <th className="p-3">สถานะ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-xs">
                  {maintenances.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-slate-400">
                        ยังไม่มีประวัติการซ่อมบำรุงสำหรับครุภัณฑ์นี้
                      </td>
                    </tr>
                  ) : (
                    maintenances.map((m) => (
                      <tr key={m.id}>
                        <td className="p-3 font-mono font-semibold text-gov-700">{m.ticket_no}</td>
                        <td className="p-3">{formatThaiDate(m.reported_date)}</td>
                        <td className="p-3">
                          <p className="font-medium text-slate-900">{m.issue_description}</p>
                          {m.resolution_notes && (
                            <p className="text-slate-500">ผลการซ่อม: {m.resolution_notes}</p>
                          )}
                        </td>
                        <td className="p-3">{m.vendor_name || '-'}</td>
                        <td className="p-3 text-right font-semibold">
                          {formatCurrency(m.actual_cost)}
                        </td>
                        <td className="p-3">
                          <StatusBadge
                            label={MAINTENANCE_STATUS_META[m.status]?.label || m.status}
                            className={MAINTENANCE_STATUS_META[m.status]?.badgeClass}
                          />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'inventory' && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs font-semibold text-slate-600 border-b border-slate-200">
                <tr>
                  <th className="p-3">รอบตรวจนับ</th>
                  <th className="p-3">ปีงบประมาณ</th>
                  <th className="p-3">วันเวลาที่ตรวจนับ</th>
                  <th className="p-3">สถานที่พบจริง</th>
                  <th className="p-3">ผู้ตรวจนับ</th>
                  <th className="p-3">ผลการตรวจนับ</th>
                  <th className="p-3">หมายเหตุ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {inventories.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-slate-400">
                      ยังไม่มีประวัติการตรวจนับประจำปีสำหรับครุภัณฑ์นี้
                    </td>
                  </tr>
                ) : (
                  inventories.map((inv) => (
                    <tr key={inv.id}>
                      <td className="p-3 font-semibold text-gov-700">
                        {inv.session?.session_code || '-'} ({inv.session?.name || '-'})
                      </td>
                      <td className="p-3">{inv.session?.fiscal_year || '-'}</td>
                      <td className="p-3">{formatThaiDateTime(inv.inspected_at)}</td>
                      <td className="p-3">
                        {inv.actual_location
                          ? `${inv.actual_location.building} ห้อง ${inv.actual_location.room || '-'}`
                          : '-'}
                      </td>
                      <td className="p-3">{inv.inspector?.full_name || '-'}</td>
                      <td className="p-3">
                        <StatusBadge
                          label={INVENTORY_RESULT_META[inv.result_status]?.label || inv.result_status}
                          className={INVENTORY_RESULT_META[inv.result_status]?.badgeClass}
                        />
                      </td>
                      <td className="p-3">{inv.notes || '-'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'attachments' && (
          <div className="space-y-4">
            {canEdit && (
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs">
                <span className="font-semibold text-slate-700">เพิ่มไฟล์แนบใหม่:</span>
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-gov-700 px-3 py-1.5 font-semibold text-white hover:bg-gov-800">
                  {uploadingFile ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                  <span>อัปโหลดเอกสารจัดซื้อ/ใบตรวจรับ (Private)</span>
                  <input
                    type="file"
                    accept="application/pdf,image/jpeg,image/png,image/webp"
                    disabled={uploadingFile}
                    onChange={(e) => handleUploadAttachment(e, 'procurement')}
                    className="hidden"
                  />
                </label>
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-100">
                  <Upload className="h-3.5 w-3.5" />
                  <span>อัปโหลดรูปภาพครุภัณฑ์</span>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    disabled={uploadingFile}
                    onChange={(e) => handleUploadAttachment(e, 'image')}
                    className="hidden"
                  />
                </label>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs font-semibold text-slate-600 border-b border-slate-200">
                  <tr>
                    <th className="p-3">ชื่อไฟล์</th>
                    <th className="p-3">ประเภทเอกสาร</th>
                    <th className="p-3">Storage Bucket</th>
                    <th className="p-3">ขนาดไฟล์</th>
                    <th className="p-3">วันที่อัปโหลด</th>
                    <th className="p-3 text-right">จัดการ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-xs">
                  {attachments.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-slate-400">
                        ยังไม่มีเอกสารแนบสำหรับครุภัณฑ์นี้
                      </td>
                    </tr>
                  ) : (
                    attachments.map((att) => (
                      <tr key={att.id}>
                        <td className="p-3 font-medium text-slate-900 flex items-center gap-2">
                          <FileText className="h-4 w-4 text-gov-700 shrink-0" />
                          {att.file_name}
                        </td>
                        <td className="p-3">{att.category}</td>
                        <td className="p-3 font-mono text-[11px]">{att.bucket_name}</td>
                        <td className="p-3">{(att.file_size / 1024).toFixed(1)} KB</td>
                        <td className="p-3">{formatThaiDateTime(att.created_at)}</td>
                        <td className="p-3 text-right">
                          <div className="inline-flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => handleOpenAttachment(att)}
                              className="inline-flex items-center gap-1 rounded-md bg-gov-50 px-2.5 py-1 text-xs font-semibold text-gov-700 hover:bg-gov-100"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                              เปิดดูไฟล์
                            </button>
                            {canEdit && (
                              <button
                                type="button"
                                onClick={() => setAttachmentToDelete(att)}
                                className="rounded-md p-1 text-rose-600 hover:bg-rose-50"
                                title="ลบไฟล์แนบ"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'audit' && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs font-semibold text-slate-600 border-b border-slate-200">
                <tr>
                  <th className="p-3">วันเวลา</th>
                  <th className="p-3">ผู้ดำเนินการ</th>
                  <th className="p-3">การกระทำ (Action)</th>
                  <th className="p-3">รายละเอียด</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {audits.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="p-8 text-center text-slate-400">
                      ยังไม่มีประวัติ Audit Log สำหรับครุภัณฑ์นี้
                    </td>
                  </tr>
                ) : (
                  audits.map((log) => (
                    <tr key={log.id}>
                      <td className="p-3 whitespace-nowrap">{formatThaiDateTime(log.created_at)}</td>
                      <td className="p-3">
                        {log.actor_email || 'ระบบ'} ({log.actor_role || '-'})
                      </td>
                      <td className="p-3 font-mono font-semibold text-gov-700">{log.action}</td>
                      <td className="p-3">{log.summary}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(attachmentToDelete)}
        onClose={() => setAttachmentToDelete(null)}
        onConfirm={confirmDeleteAttachment}
        title="ยืนยันการลบไฟล์แนบ"
        description={`คุณต้องการลบไฟล์ "${attachmentToDelete?.file_name || ''}" ออกจาก Storage และฐานข้อมูลใช่หรือไม่?`}
        confirmLabel="ยืนยันลบไฟล์"
      />
    </div>
  );
}
