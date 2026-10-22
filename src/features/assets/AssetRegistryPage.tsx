import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';
import {
  Plus,
  Search,
  FileSpreadsheet,
  FileText,
  Upload,
  Eye,
  Edit3,
  QrCode,
  Loader2,
  ArrowUpDown,
  FilterX,
  Image as ImageIcon,
  CheckCircle2,
  AlertTriangle,
  Trash2,
  Archive,
} from 'lucide-react';
import { assertSupabaseConfigured, isSupabaseConfigured, recordAuditLog, supabase } from '@/lib/supabase';
import {
  ASSET_STATUS_META,
  formatCurrency,
  translateSupabaseError,
} from '@/lib/utils';
import { formatThaiDate, toISODateInput } from '@/lib/date';
import { exportToExcel, exportToPDF } from '@/lib/export';
import { uploadFileToBucket } from '@/lib/storage';
import { useAuth } from '@/features/auth/AuthContext';
import { useCategories, useDepartments, useLocations, useProfiles, useSystemSettings } from '@/hooks/useMasterData';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  Modal,
  PageHeader,
  PaginationControls,
  StatusBadge,
} from '@/components/ui/common';
import type { Asset, AssetStatus } from '@/types/database';

const assetFormSchema = z.object({
  asset_code: z.string().min(2, 'กรุณาระบุเลขครุภัณฑ์'),
  name: z.string().min(2, 'กรุณาระบุชื่อครุภัณฑ์'),
  category_id: z.string().min(1, 'กรุณาเลือกประเภท/หมวดหมู่ครุภัณฑ์'),
  brand: z.string().optional(),
  model: z.string().optional(),
  serial_number: z.string().optional(),
  description: z.string().optional(),
  unit_price: z.coerce.number().min(0, 'ราคาต่อหน่วยต้องไม่ติดลบ'),
  acquired_date: z.string().min(1, 'กรุณาระบุวันที่รับเข้า/ตรวจรับ'),
  contract_number: z.string().optional(),
  useful_life_years: z.coerce.number().min(1).max(50).optional(),
  status: z.enum(['available', 'borrowed', 'under_maintenance', 'pending_disposal', 'disposed', 'lost']),
  department_id: z.string().min(1, 'กรุณาเลือกหน่วยงานผู้ครอบครอง'),
  location_id: z.string().optional(),
  custodian_id: z.string().optional(),
  notes: z.string().optional(),
});

type AssetFormValues = z.infer<typeof assetFormSchema>;

interface ImportPreviewRow {
  rowNumber: number;
  asset_code: string;
  name: string;
  category_code: string;
  department_code: string;
  brand: string;
  model: string;
  serial_number: string;
  unit_price: number;
  acquired_date: string;
  contract_number: string;
  errors: string[];
  category_id?: string;
  department_id?: string;
}

export function AssetRegistryPage() {
  const { user, hasRole } = useAuth();
  const canEdit = hasRole(['admin', 'asset_officer']);
  const queryClient = useQueryClient();
  const configured = isSupabaseConfigured();

  // Master data
  const { data: categories = [] } = useCategories();
  const { data: departments = [] } = useDepartments();
  const { data: locations = [] } = useLocations();
  const { data: profiles = [] } = useProfiles();
  const { data: settings } = useSystemSettings();

  // Filters & Pagination state
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [locationFilter, setLocationFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sortField, setSortField] = useState<'asset_code' | 'name' | 'unit_price' | 'acquired_date'>('asset_code');
  const [sortAsc, setSortAsc] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Modal states
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingAsset, setEditingAsset] = useState<Asset | null>(null);
  const [deletingAsset, setDeletingAsset] = useState<Asset | null>(null);
  const [isDeletingAsset, setIsDeletingAsset] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [docFile, setDocFile] = useState<File | null>(null);

  // Import CSV/XLSX state
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [importRows, setImportRows] = useState<ImportPreviewRow[]>([]);
  const [isImporting, setIsImporting] = useState(false);

  const {
    data: assets = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['assets-list'],
    queryFn: async () => {
      if (!configured) return [] as Asset[];
      const { data, error: fetchError } = await supabase
        .from('assets')
        .select(
          '*, category:asset_categories(*), department:departments(*), location:locations(*), custodian:profiles!assets_custodian_id_fkey(*)'
        )
        .eq('is_archived', false)
        .order('created_at', { ascending: false });
      if (fetchError) throw fetchError;
      return (data || []) as Asset[];
    },
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<AssetFormValues>({
    resolver: zodResolver(assetFormSchema),
    defaultValues: {
      asset_code: '',
      name: '',
      category_id: '',
      brand: '',
      model: '',
      serial_number: '',
      description: '',
      unit_price: 0,
      acquired_date: toISODateInput(),
      contract_number: '',
      useful_life_years: 5,
      status: 'available',
      department_id: '',
      location_id: '',
      custodian_id: '',
      notes: '',
    },
  });

  const openCreateModal = () => {
    setEditingAsset(null);
    setImageFile(null);
    setDocFile(null);
    reset({
      asset_code: '',
      name: '',
      category_id: categories[0]?.id || '',
      brand: '',
      model: '',
      serial_number: '',
      description: '',
      unit_price: 0,
      acquired_date: toISODateInput(),
      contract_number: '',
      useful_life_years: 5,
      status: 'available',
      department_id: departments[0]?.id || '',
      location_id: '',
      custodian_id: '',
      notes: '',
    });
    setIsFormOpen(true);
  };

  const openEditModal = (asset: Asset) => {
    setEditingAsset(asset);
    setImageFile(null);
    setDocFile(null);
    reset({
      asset_code: asset.asset_code,
      name: asset.name,
      category_id: asset.category_id,
      brand: asset.brand || '',
      model: asset.model || '',
      serial_number: asset.serial_number || '',
      description: asset.description || '',
      unit_price: Number(asset.unit_price),
      acquired_date: asset.acquired_date,
      contract_number: asset.contract_number || '',
      useful_life_years: asset.useful_life_years || 5,
      status: asset.status,
      department_id: asset.department_id,
      location_id: asset.location_id || '',
      custodian_id: asset.custodian_id || '',
      notes: asset.notes || '',
    });
    setIsFormOpen(true);
  };

  const onSubmitAsset = async (values: AssetFormValues) => {
    try {
      assertSupabaseConfigured();

      // ตรวจสอบเลขครุภัณฑ์ซ้ำก่อนบันทึก
      const normalizedCode = values.asset_code.trim();
      const { data: existingDup } = await supabase
        .from('assets')
        .select('id')
        .eq('asset_code', normalizedCode)
        .maybeSingle();

      if (existingDup && existingDup.id !== editingAsset?.id) {
        toast.error(`เลขครุภัณฑ์ "${normalizedCode}" มีอยู่ในระบบแล้ว กรุณาระบุเลขที่ไม่ซ้ำ`);
        return;
      }

      let imageUrl = editingAsset?.image_url || null;
      let uploadedImagePath: string | null = null;

      if (imageFile) {
        const uploaded = await uploadFileToBucket({
          bucket: 'asset-images',
          folder: 'registry',
          file: imageFile,
        });
        imageUrl = uploaded.publicUrl;
        uploadedImagePath = uploaded.path;
      }

      const payload = {
        asset_code: normalizedCode,
        name: values.name.trim(),
        category_id: values.category_id,
        brand: values.brand?.trim() || null,
        model: values.model?.trim() || null,
        serial_number: values.serial_number?.trim() || null,
        description: values.description?.trim() || null,
        unit_price: Number(values.unit_price),
        acquired_date: values.acquired_date,
        contract_number: values.contract_number?.trim() || null,
        useful_life_years: values.useful_life_years || 5,
        status: values.status,
        department_id: values.department_id,
        location_id: values.location_id || null,
        custodian_id: values.custodian_id || null,
        image_url: imageUrl,
        notes: values.notes?.trim() || null,
        updated_by: user?.id || null,
      };

      let savedAssetId = editingAsset?.id;

      if (editingAsset) {
        const { error: updateErr } = await supabase
          .from('assets')
          .update(payload)
          .eq('id', editingAsset.id);
        if (updateErr) throw updateErr;

        await recordAuditLog({
          action: 'ASSET_UPDATED',
          entityType: 'assets',
          entityId: editingAsset.id,
          summary: `แก้ไขข้อมูลครุภัณฑ์ ${normalizedCode} (${values.name})`,
          beforeData: {
            asset_code: editingAsset.asset_code,
            name: editingAsset.name,
            status: editingAsset.status,
            unit_price: editingAsset.unit_price,
          },
          afterData: payload,
        });
      } else {
        const { data: created, error: insertErr } = await supabase
          .from('assets')
          .insert({
            ...payload,
            created_by: user?.id || null,
          })
          .select('id')
          .single();

        if (insertErr) throw insertErr;
        savedAssetId = created.id;

        await recordAuditLog({
          action: 'ASSET_CREATED',
          entityType: 'assets',
          entityId: savedAssetId,
          summary: `ขึ้นทะเบียนครุภัณฑ์ใหม่ ${normalizedCode} (${values.name})`,
          afterData: payload,
        });
      }

      // บันทึกข้อมูลไฟล์แนบในตาราง asset_attachments
      if (savedAssetId && imageFile && uploadedImagePath) {
        await supabase.from('asset_attachments').insert({
          asset_id: savedAssetId,
          file_name: imageFile.name,
          file_path: uploadedImagePath,
          file_type: imageFile.type,
          file_size: imageFile.size,
          bucket_name: 'asset-images',
          category: 'image',
          uploaded_by: user?.id || null,
        });
      }

      if (savedAssetId && docFile) {
        const uploadedDoc = await uploadFileToBucket({
          bucket: 'asset-documents',
          folder: savedAssetId,
          file: docFile,
        });
        await supabase.from('asset_attachments').insert({
          asset_id: savedAssetId,
          file_name: docFile.name,
          file_path: uploadedDoc.path,
          file_type: docFile.type,
          file_size: docFile.size,
          bucket_name: 'asset-documents',
          category: 'procurement',
          uploaded_by: user?.id || null,
        });
      }

      toast.success(editingAsset ? 'บันทึกการแก้ไขครุภัณฑ์สำเร็จ' : 'ขึ้นทะเบียนครุภัณฑ์ใหม่สำเร็จ');
      setIsFormOpen(false);
      queryClient.invalidateQueries({ queryKey: ['assets-list'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
    } catch (err) {
      toast.error(translateSupabaseError(err));
    }
  };

  const handleDeleteAsset = async () => {
    if (!deletingAsset) return;
    setIsDeletingAsset(true);
    try {
      assertSupabaseConfigured();
      const { error: rpcErr } = await supabase.rpc('delete_asset_cascade', {
        p_asset_id: deletingAsset.id,
      });

      if (rpcErr) {
        const { error: delErr } = await supabase
          .from('assets')
          .delete()
          .eq('id', deletingAsset.id);
        if (delErr) throw delErr;

        await recordAuditLog({
          action: 'ASSET_DELETED',
          entityType: 'assets',
          entityId: deletingAsset.id,
          summary: `ลบครุภัณฑ์ ${deletingAsset.asset_code} (${deletingAsset.name}) ออกจากระบบ`,
        });
      }

      toast.success(`ลบครุภัณฑ์ ${deletingAsset.asset_code} ออกจากระบบเรียบร้อยแล้ว`);
      setDeletingAsset(null);
      queryClient.invalidateQueries({ queryKey: ['assets-list'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
    } catch (err) {
      toast.error(translateSupabaseError(err));
    } finally {
      setIsDeletingAsset(false);
    }
  };

  const handleArchiveAsset = async () => {
    if (!deletingAsset) return;
    setIsDeletingAsset(true);
    try {
      assertSupabaseConfigured();
      const { error: archErr } = await supabase
        .from('assets')
        .update({ is_archived: true, updated_by: user?.id || null })
        .eq('id', deletingAsset.id);
      if (archErr) throw archErr;

      await recordAuditLog({
        action: 'ASSET_ARCHIVED',
        entityType: 'assets',
        entityId: deletingAsset.id,
        summary: `ย้ายครุภัณฑ์ ${deletingAsset.asset_code} (${deletingAsset.name}) เข้าแฟ้มประวัติ (Archive)`,
      });

      toast.success(`ย้ายครุภัณฑ์ ${deletingAsset.asset_code} เข้าแฟ้มประวัติเรียบร้อยแล้ว`);
      setDeletingAsset(null);
      queryClient.invalidateQueries({ queryKey: ['assets-list'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
    } catch (err) {
      toast.error(translateSupabaseError(err));
    } finally {
      setIsDeletingAsset(false);
    }
  };

  // กรองและเรียงลำดับข้อมูล
  const filteredAssets = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return assets
      .filter((a) => {
        if (q) {
          const matchCode = a.asset_code.toLowerCase().includes(q);
          const matchName = a.name.toLowerCase().includes(q);
          const matchBrand = (a.brand || '').toLowerCase().includes(q);
          const matchModel = (a.model || '').toLowerCase().includes(q);
          const matchSerial = (a.serial_number || '').toLowerCase().includes(q);
          const matchLoc = (a.location?.name || '').toLowerCase().includes(q);
          const matchCust = (a.custodian?.full_name || '').toLowerCase().includes(q);
          if (!matchCode && !matchName && !matchBrand && !matchModel && !matchSerial && !matchLoc && !matchCust) {
            return false;
          }
        }
        if (categoryFilter && a.category_id !== categoryFilter) return false;
        if (statusFilter && a.status !== statusFilter) return false;
        if (deptFilter && a.department_id !== deptFilter) return false;
        if (locationFilter && a.location_id !== locationFilter) return false;
        if (dateFrom && a.acquired_date < dateFrom) return false;
        if (dateTo && a.acquired_date > dateTo) return false;
        return true;
      })
      .sort((a, b) => {
        let cmp = 0;
        if (sortField === 'unit_price') {
          cmp = Number(a.unit_price) - Number(b.unit_price);
        } else if (sortField === 'acquired_date') {
          cmp = a.acquired_date.localeCompare(b.acquired_date);
        } else if (sortField === 'name') {
          cmp = a.name.localeCompare(b.name, 'th');
        } else {
          cmp = a.asset_code.localeCompare(b.asset_code, 'th');
        }
        return sortAsc ? cmp : -cmp;
      });
  }, [
    assets,
    searchTerm,
    categoryFilter,
    statusFilter,
    deptFilter,
    locationFilter,
    dateFrom,
    dateTo,
    sortField,
    sortAsc,
  ]);

  const totalPages = Math.max(1, Math.ceil(filteredAssets.length / pageSize));
  const paginatedAssets = filteredAssets.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );

  const toggleSort = (field: typeof sortField) => {
    if (sortField === field) {
      setSortAsc((prev) => !prev);
    } else {
      setSortField(field);
      setSortAsc(true);
    }
  };

  const clearFilters = () => {
    setSearchTerm('');
    setCategoryFilter('');
    setStatusFilter('');
    setDeptFilter('');
    setLocationFilter('');
    setDateFrom('');
    setDateTo('');
    setCurrentPage(1);
  };

  // Export เฉพาะรายการที่กรองอยู่ตามสิทธิ์
  const handleExport = (format: 'xlsx' | 'pdf') => {
    if (filteredAssets.length === 0) {
      toast.error('ไม่มีรายการครุภัณฑ์ให้ส่งออก');
      return;
    }

    const rows = filteredAssets.map((a, idx) => ({
      seq: idx + 1,
      asset_code: a.asset_code,
      name: a.name,
      category: a.category?.name || '-',
      brand_model: [a.brand, a.model].filter(Boolean).join(' ') || '-',
      serial_number: a.serial_number || '-',
      department: a.department?.name || '-',
      location: a.location ? `${a.location.building} ${a.location.room || ''}`.trim() : '-',
      custodian: a.custodian?.full_name || '-',
      acquired_date: formatThaiDate(a.acquired_date),
      unit_price: Number(a.unit_price),
      status: ASSET_STATUS_META[a.status]?.label || a.status,
    }));

    const cols: { key: keyof (typeof rows)[0]; header: string }[] = [
      { key: 'seq', header: 'ลำดับ' },
      { key: 'asset_code', header: 'เลขครุภัณฑ์' },
      { key: 'name', header: 'ชื่อครุภัณฑ์' },
      { key: 'category', header: 'หมวดหมู่' },
      { key: 'brand_model', header: 'ยี่ห้อ/รุ่น' },
      { key: 'serial_number', header: 'Serial No.' },
      { key: 'department', header: 'หน่วยงาน' },
      { key: 'location', header: 'สถานที่ตั้ง' },
      { key: 'custodian', header: 'ผู้รับผิดชอบ' },
      { key: 'acquired_date', header: 'วันที่รับเข้า' },
      { key: 'unit_price', header: 'ราคาต่อหน่วย (บาท)' },
      { key: 'status', header: 'สถานะ' },
    ];

    const meta = {
      reportTitle: 'รายงานทะเบียนครุภัณฑ์สำนักงาน (Asset Registry Report)',
      orgName: settings?.org_name,
      filtersSummary: `คำค้น: ${searchTerm || 'ทั้งหมด'} | จำนวน ${filteredAssets.length} รายการ`,
      fileNamePrefix: 'asset_registry',
    };

    if (format === 'xlsx') {
      exportToExcel(rows, cols, meta);
      toast.success('ส่งออกไฟล์ Excel (.xlsx) สำเร็จ');
    } else {
      exportToPDF(rows, cols, meta);
      toast.success('ส่งออกไฟล์ PDF สำเร็จ');
    }
  };

  // อ่านไฟล์ CSV / XLSX เพื่อแสดง Preview และตรวจสอบความถูกต้องก่อนบันทึก
  const handleFileImportSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const rawJson = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });

      const existingCodes = new Set(assets.map((a) => a.asset_code.toLowerCase()));
      const seenInFile = new Set<string>();

      const parsed: ImportPreviewRow[] = rawJson.map((row, index) => {
        const rowErrors: string[] = [];
        const asset_code = String(row['asset_code'] || row['เลขครุภัณฑ์'] || '').trim();
        const name = String(row['name'] || row['ชื่อครุภัณฑ์'] || '').trim();
        const category_code = String(row['category_code'] || row['รหัสหมวดหมู่'] || '').trim();
        const department_code = String(row['department_code'] || row['รหัสหน่วยงาน'] || '').trim();
        const brand = String(row['brand'] || row['ยี่ห้อ'] || '').trim();
        const model = String(row['model'] || row['รุ่น'] || '').trim();
        const serial_number = String(row['serial_number'] || row['Serial'] || '').trim();
        const unit_price = Number(row['unit_price'] || row['ราคาต่อหน่วย'] || 0);
        const acquired_date = String(row['acquired_date'] || row['วันที่รับเข้า'] || toISODateInput()).trim();
        const contract_number = String(row['contract_number'] || row['เลขที่สัญญา'] || '').trim();

        if (!asset_code) rowErrors.push('ไม่มีเลขครุภัณฑ์');
        if (!name) rowErrors.push('ไม่มีชื่อครุภัณฑ์');
        if (Number.isNaN(unit_price) || unit_price < 0) rowErrors.push('ราคาต่อหน่วยไม่ถูกต้อง');

        if (asset_code) {
          const lower = asset_code.toLowerCase();
          if (existingCodes.has(lower)) {
            rowErrors.push('เลขครุภัณฑ์ซ้ำกับในระบบ');
          } else if (seenInFile.has(lower)) {
            rowErrors.push('เลขครุภัณฑ์ซ้ำกันเองในไฟล์');
          }
          seenInFile.add(lower);
        }

        const matchedCat = categories.find(
          (c) => c.code.toLowerCase() === category_code.toLowerCase() || c.name === category_code
        );
        if (!matchedCat) {
          rowErrors.push(`ไม่พบรหัสหมวดหมู่ "${category_code || '-'}"`);
        }

        const matchedDept = departments.find(
          (d) => d.code.toLowerCase() === department_code.toLowerCase() || d.name === department_code
        );
        if (!matchedDept) {
          rowErrors.push(`ไม่พบรหัสหน่วยงาน "${department_code || '-'}"`);
        }

        return {
          rowNumber: index + 2,
          asset_code,
          name,
          category_code,
          department_code,
          brand,
          model,
          serial_number,
          unit_price: Number.isNaN(unit_price) ? 0 : unit_price,
          acquired_date,
          contract_number,
          errors: rowErrors,
          category_id: matchedCat?.id,
          department_id: matchedDept?.id,
        };
      });

      setImportRows(parsed);
    } catch (err) {
      toast.error(`ไม่สามารถอ่านไฟล์นำเข้าได้: ${translateSupabaseError(err)}`);
    }
  };

  const confirmImportValidRows = async () => {
    const validRows = importRows.filter((r) => r.errors.length === 0 && r.category_id && r.department_id);
    if (validRows.length === 0) {
      toast.error('ไม่มีรายการที่ผ่านการตรวจสอบความถูกต้องให้นำเข้า');
      return;
    }

    setIsImporting(true);
    try {
      assertSupabaseConfigured();
      const payload = validRows.map((r) => ({
        asset_code: r.asset_code,
        name: r.name,
        category_id: r.category_id!,
        department_id: r.department_id!,
        brand: r.brand || null,
        model: r.model || null,
        serial_number: r.serial_number || null,
        unit_price: r.unit_price,
        acquired_date: r.acquired_date,
        contract_number: r.contract_number || null,
        status: 'available' as AssetStatus,
        created_by: user?.id || null,
        updated_by: user?.id || null,
      }));

      const { error: insertErr } = await supabase.from('assets').insert(payload);
      if (insertErr) throw insertErr;

      await recordAuditLog({
        action: 'ASSET_BULK_IMPORT',
        entityType: 'assets',
        summary: `นำเข้าข้อมูลครุภัณฑ์จากไฟล์สำเร็จจำนวน ${validRows.length} รายการ`,
      });

      toast.success(`นำเข้าข้อมูลครุภัณฑ์สำเร็จ ${validRows.length} รายการ`);
      setIsImportOpen(false);
      setImportRows([]);
      queryClient.invalidateQueries({ queryKey: ['assets-list'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
    } catch (err) {
      toast.error(translateSupabaseError(err));
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="ทะเบียนครุภัณฑ์สำนักงาน (Asset Registry)"
        subtitle="ค้นหา ตรวจสอบ เพิ่ม/แก้ไข นำเข้า และส่งออกข้อมูลครุภัณฑ์ของหน่วยงาน"
        actions={
          <>
            <button
              type="button"
              onClick={() => handleExport('xlsx')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
              Export Excel
            </button>
            <button
              type="button"
              onClick={() => handleExport('pdf')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              <FileText className="h-4 w-4 text-rose-600" />
              Export PDF
            </button>
            {canEdit && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setImportRows([]);
                    setIsImportOpen(true);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gov-300 bg-gov-50 px-3 py-2 text-xs font-semibold text-gov-800 hover:bg-gov-100"
                >
                  <Upload className="h-4 w-4" />
                  นำเข้า CSV/XLSX
                </button>
                <button
                  type="button"
                  onClick={openCreateModal}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-gov-700 px-3.5 py-2 text-xs font-semibold text-white shadow-xs hover:bg-gov-800"
                >
                  <Plus className="h-4 w-4" />
                  เพิ่มครุภัณฑ์ใหม่
                </button>
              </>
            )}
          </>
        }
      />

      {/* ตัวกรองและช่องค้นหา */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs space-y-3">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <div className="relative md:col-span-2">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setCurrentPage(1);
              }}
              placeholder="ค้นหาเลขครุภัณฑ์, ชื่อ, ยี่ห้อ, รุ่น, Serial Number, สถานที่, ผู้รับผิดชอบ..."
              className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm focus:border-gov-600 focus:outline-none"
            />
          </div>

          <select
            value={categoryFilter}
            onChange={(e) => {
              setCategoryFilter(e.target.value);
              setCurrentPage(1);
            }}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-gov-600 focus:outline-none"
          >
            <option value="">ทุกหมวดหมู่ครุภัณฑ์</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.code} - {cat.name}
              </option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setCurrentPage(1);
            }}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-gov-600 focus:outline-none"
          >
            <option value="">ทุกสถานะ</option>
            {Object.entries(ASSET_STATUS_META).map(([key, meta]) => (
              <option key={key} value={key}>
                {meta.label}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-5">
          <select
            value={deptFilter}
            onChange={(e) => {
              setDeptFilter(e.target.value);
              setCurrentPage(1);
            }}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs focus:border-gov-600 focus:outline-none"
          >
            <option value="">ทุกหน่วยงาน/กอง</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.code} - {d.name}
              </option>
            ))}
          </select>

          <select
            value={locationFilter}
            onChange={(e) => {
              setLocationFilter(e.target.value);
              setCurrentPage(1);
            }}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs focus:border-gov-600 focus:outline-none"
          >
            <option value="">ทุกอาคาร/สถานที่ตั้ง</option>
            {locations.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.building} ห้อง {loc.room || '-'} ({loc.name})
              </option>
            ))}
          </select>

          <div className="flex items-center gap-1.5">
            <span className="text-xs text-slate-500 shrink-0">รับเข้าตั้งแต่:</span>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => {
                setDateFrom(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
            />
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-xs text-slate-500 shrink-0">ถึงวันที่:</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => {
                setDateTo(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
            />
          </div>

          <button
            type="button"
            onClick={clearFilters}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
          >
            <FilterX className="h-3.5 w-3.5" />
            ล้างตัวกรอง
          </button>
        </div>
      </div>

      {/* ตารางแสดงผล */}
      {isLoading ? (
        <LoadingState message="กำลังโหลดทะเบียนครุภัณฑ์..." />
      ) : error ? (
        <ErrorState message={translateSupabaseError(error)} onRetry={() => refetch()} />
      ) : filteredAssets.length === 0 ? (
        <EmptyState
          title="ไม่พบรายการครุภัณฑ์"
          description="ยังไม่มีข้อมูลครุภัณฑ์ที่ตรงกับเงื่อนไขการค้นหา หรือยังไม่ได้เพิ่มข้อมูลในฐานข้อมูล"
          action={
            canEdit && (
              <button
                type="button"
                onClick={openCreateModal}
                className="inline-flex items-center gap-1.5 rounded-lg bg-gov-700 px-4 py-2 text-xs font-semibold text-white hover:bg-gov-800"
              >
                <Plus className="h-4 w-4" />
                เพิ่มครุภัณฑ์รายการแรก
              </button>
            )
          }
        />
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white shadow-2xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                <tr>
                  <th className="px-4 py-3">รูป</th>
                  <th className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => toggleSort('asset_code')}
                      className="inline-flex items-center gap-1 hover:text-gov-700"
                    >
                      เลขครุภัณฑ์ <ArrowUpDown className="h-3.5 w-3.5" />
                    </button>
                  </th>
                  <th className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => toggleSort('name')}
                      className="inline-flex items-center gap-1 hover:text-gov-700"
                    >
                      ชื่อและรายละเอียด <ArrowUpDown className="h-3.5 w-3.5" />
                    </button>
                  </th>
                  <th className="px-4 py-3">หมวดหมู่</th>
                  <th className="px-4 py-3">หน่วยงาน / สถานที่ตั้ง</th>
                  <th className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => toggleSort('unit_price')}
                      className="inline-flex items-center gap-1 hover:text-gov-700"
                    >
                      ราคาต่อหน่วย <ArrowUpDown className="h-3.5 w-3.5" />
                    </button>
                  </th>
                  <th className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => toggleSort('acquired_date')}
                      className="inline-flex items-center gap-1 hover:text-gov-700"
                    >
                      วันที่รับเข้า <ArrowUpDown className="h-3.5 w-3.5" />
                    </button>
                  </th>
                  <th className="px-4 py-3">สถานะ</th>
                  <th className="px-4 py-3 text-right">จัดการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs sm:text-sm">
                {paginatedAssets.map((asset) => {
                  const statusMeta = ASSET_STATUS_META[asset.status];
                  return (
                    <tr key={asset.id} className="hover:bg-slate-50/80">
                      <td className="px-4 py-3">
                        {asset.image_url ? (
                          <img
                            src={asset.image_url}
                            alt={asset.name}
                            className="h-10 w-10 rounded-lg object-cover border border-slate-200"
                          />
                        ) : (
                          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-400">
                            <ImageIcon className="h-5 w-5" />
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono font-semibold text-gov-700 whitespace-nowrap">
                        <Link to={`/assets/${asset.id}`} className="hover:underline">
                          {asset.asset_code}
                        </Link>
                        {asset.serial_number && (
                          <p className="text-[11px] font-normal text-slate-400">
                            S/N: {asset.serial_number}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-semibold text-slate-900">{asset.name}</p>
                        <p className="text-xs text-slate-500">
                          {[asset.brand, asset.model].filter(Boolean).join(' • ') || 'ไม่ระบุยี่ห้อ/รุ่น'}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{asset.category?.name || '-'}</td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-800">{asset.department?.name || '-'}</p>
                        <p className="text-xs text-slate-500">
                          {asset.location
                            ? `${asset.location.building} ห้อง ${asset.location.room || '-'}`
                            : 'ไม่ระบุห้อง'}
                          {asset.custodian ? ` • ${asset.custodian.full_name}` : ''}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-slate-800 whitespace-nowrap">
                        {formatCurrency(asset.unit_price)}
                      </td>
                      <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                        {formatThaiDate(asset.acquired_date)}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge
                          label={statusMeta?.label || asset.status}
                          className={statusMeta?.badgeClass}
                          dotClass={statusMeta?.dotClass}
                        />
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          <Link
                            to={`/assets/${asset.id}`}
                            className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100 hover:text-gov-700"
                            title="ดูรายละเอียดครบทุก Tab"
                          >
                            <Eye className="h-4 w-4" />
                          </Link>
                          <Link
                            to={`/qr-barcode?assetId=${asset.id}`}
                            className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100 hover:text-gov-700"
                            title="พิมพ์ฉลาก QR / Barcode"
                          >
                            <QrCode className="h-4 w-4" />
                          </Link>
                          {canEdit && (
                            <>
                              <button
                                type="button"
                                onClick={() => openEditModal(asset)}
                                className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100 hover:text-gov-700"
                                title="แก้ไขข้อมูลครุภัณฑ์"
                              >
                                <Edit3 className="h-4 w-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeletingAsset(asset)}
                                className="rounded-lg p-1.5 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                                title="ลบครุภัณฑ์"
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

          <PaginationControls
            currentPage={currentPage}
            totalPages={totalPages}
            totalItems={filteredAssets.length}
            pageSize={pageSize}
            onPageChange={setCurrentPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setCurrentPage(1);
            }}
          />
        </div>
      )}

      {/* Modal เพิ่ม/แก้ไขครุภัณฑ์ */}
      <Modal
        open={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        title={editingAsset ? `แก้ไขครุภัณฑ์: ${editingAsset.asset_code}` : 'ขึ้นทะเบียนครุภัณฑ์ใหม่'}
        description="กรอกรายละเอียดครุภัณฑ์ตามใบตรวจรับพัสดุ เลขครุภัณฑ์ต้องไม่ซ้ำกับที่มีในระบบ"
        maxWidth="max-w-3xl"
      >
        <form onSubmit={handleSubmit(onSubmitAsset)} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-slate-700">
                เลขครุภัณฑ์ (Asset Code) <span className="text-rose-600">*</span>
              </label>
              <input
                type="text"
                placeholder="เช่น กพท-7440-2569-0001"
                {...register('asset_code')}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono focus:border-gov-600 focus:outline-none"
              />
              {errors.asset_code && (
                <p className="mt-1 text-xs text-rose-600">{errors.asset_code.message}</p>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">
                ชื่อครุภัณฑ์ <span className="text-rose-600">*</span>
              </label>
              <input
                type="text"
                placeholder="เช่น เครื่องคอมพิวเตอร์โน้ตบุ๊ก สำหรับงานประมวลผล"
                {...register('name')}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-gov-600 focus:outline-none"
              />
              {errors.name && <p className="mt-1 text-xs text-rose-600">{errors.name.message}</p>}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">
                หมวดหมู่ครุภัณฑ์ <span className="text-rose-600">*</span>
              </label>
              <select
                {...register('category_id')}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                <option value="">-- เลือกหมวดหมู่ --</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} - {c.name}
                  </option>
                ))}
              </select>
              {errors.category_id && (
                <p className="mt-1 text-xs text-rose-600">{errors.category_id.message}</p>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">
                สถานะครุภัณฑ์ <span className="text-rose-600">*</span>
              </label>
              <select
                {...register('status')}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                {Object.entries(ASSET_STATUS_META).map(([key, meta]) => (
                  <option key={key} value={key}>
                    {meta.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">ยี่ห้อ (Brand)</label>
              <input
                type="text"
                placeholder="เช่น Dell, HP, Epson"
                {...register('brand')}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">รุ่น (Model)</label>
              <input
                type="text"
                placeholder="เช่น Latitude 5440"
                {...register('model')}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">
                หมายเลขเครื่อง (Serial Number)
              </label>
              <input
                type="text"
                placeholder="ระบุ Serial Number"
                {...register('serial_number')}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">
                ราคาต่อหน่วย (บาท) <span className="text-rose-600">*</span>
              </label>
              <input
                type="number"
                step="0.01"
                {...register('unit_price')}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              {errors.unit_price && (
                <p className="mt-1 text-xs text-rose-600">{errors.unit_price.message}</p>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">
                วันที่รับเข้า / วันที่ตรวจรับ <span className="text-rose-600">*</span>
              </label>
              <input
                type="date"
                {...register('acquired_date')}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              {errors.acquired_date && (
                <p className="mt-1 text-xs text-rose-600">{errors.acquired_date.message}</p>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">
                เลขที่สัญญาจัดซื้อ / ใบตรวจรับ
              </label>
              <input
                type="text"
                placeholder="เช่น สญ.014/2569"
                {...register('contract_number')}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">
                หน่วยงาน/กองผู้ครอบครอง <span className="text-rose-600">*</span>
              </label>
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
              {errors.department_id && (
                <p className="mt-1 text-xs text-rose-600">{errors.department_id.message}</p>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">อาคาร / ห้อง / สถานที่ตั้ง</label>
              <select
                {...register('location_id')}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                <option value="">-- ไม่ระบุสถานที่ตั้ง --</option>
                {locations.map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.building} ชั้น {loc.floor || '-'} ห้อง {loc.room || '-'} ({loc.name})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">ผู้รับผิดชอบดูแลครุภัณฑ์</label>
              <select
                {...register('custodian_id')}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                <option value="">-- ไม่ระบุผู้รับผิดชอบ --</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name} ({p.email})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">
                อายุการใช้งานโดยประมาณ (ปี)
              </label>
              <input
                type="number"
                {...register('useful_life_years')}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700">คุณลักษณะเฉพาะ / รายละเอียด</label>
            <textarea
              rows={2}
              placeholder="ระบุสเปกหรือรายละเอียดประกอบ..."
              {...register('description')}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 rounded-xl border border-slate-200 bg-slate-50 p-3.5">
            <div>
              <label className="block text-xs font-semibold text-slate-700">
                อัปโหลดรูปภาพครุภัณฑ์ (JPG, PNG, WEBP ไม่เกิน 5MB)
              </label>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(e) => setImageFile(e.target.files?.[0] || null)}
                className="mt-1.5 block w-full text-xs text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-gov-700 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white hover:file:bg-gov-800"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">
                แนบเอกสารจัดซื้อ/ใบตรวจรับ (PDF หรือรูปภาพ - Private Bucket)
              </label>
              <input
                type="file"
                accept="application/pdf,image/jpeg,image/png,image/webp"
                onChange={(e) => setDocFile(e.target.files?.[0] || null)}
                className="mt-1.5 block w-full text-xs text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-700 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white hover:file:bg-slate-800"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700">หมายเหตุ</label>
            <input
              type="text"
              {...register('notes')}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-slate-200 pt-4">
            <button
              type="button"
              onClick={() => setIsFormOpen(false)}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex items-center gap-2 rounded-lg bg-gov-700 px-5 py-2 text-sm font-semibold text-white hover:bg-gov-800 disabled:opacity-60"
            >
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {editingAsset ? 'บันทึกการแก้ไข' : 'บันทึกขึ้นทะเบียนครุภัณฑ์'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal นำเข้า CSV/XLSX พร้อม Preview */}
      <Modal
        open={isImportOpen}
        onClose={() => setIsImportOpen(false)}
        title="นำเข้าข้อมูลครุภัณฑ์จากไฟล์ CSV / Excel (.xlsx)"
        description="ระบบจะตรวจสอบความถูกต้องของข้อมูลและป้องกันเลขครุภัณฑ์ซ้ำก่อนบันทึกลงฐานข้อมูลจริง"
        maxWidth="max-w-4xl"
      >
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-700 space-y-2">
            <p className="font-semibold text-slate-900">
              คอลัมน์ที่รองรับในแถวหัวตาราง (Header Row):
            </p>
            <p className="font-mono text-[11px] bg-white p-2 rounded border border-slate-200">
              asset_code (หรือ เลขครุภัณฑ์), name (หรือ ชื่อครุภัณฑ์), category_code (เช่น 7440), department_code (เช่น ITD), brand, model, serial_number, unit_price, acquired_date (YYYY-MM-DD), contract_number
            </p>
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleFileImportSelect}
              className="mt-2 block w-full text-xs text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-gov-700 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white"
            />
          </div>

          {importRows.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span>
                  พบข้อมูลทั้งหมด <strong>{importRows.length}</strong> แถว | ผ่านการตรวจสอบ{' '}
                  <strong className="text-emerald-700">
                    {importRows.filter((r) => r.errors.length === 0).length}
                  </strong>{' '}
                  แถว | พบข้อผิดพลาด{' '}
                  <strong className="text-rose-600">
                    {importRows.filter((r) => r.errors.length > 0).length}
                  </strong>{' '}
                  แถว
                </span>
              </div>

              <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-200">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-100 font-semibold text-slate-700 sticky top-0">
                    <tr>
                      <th className="p-2">แถว</th>
                      <th className="p-2">เลขครุภัณฑ์</th>
                      <th className="p-2">ชื่อครุภัณฑ์</th>
                      <th className="p-2">หมวดหมู่</th>
                      <th className="p-2">หน่วยงาน</th>
                      <th className="p-2 text-right">ราคา</th>
                      <th className="p-2">ผลการตรวจสอบ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {importRows.map((row) => (
                      <tr key={row.rowNumber} className={row.errors.length > 0 ? 'bg-rose-50/50' : ''}>
                        <td className="p-2">{row.rowNumber}</td>
                        <td className="p-2 font-mono font-medium">{row.asset_code || '-'}</td>
                        <td className="p-2">{row.name || '-'}</td>
                        <td className="p-2">{row.category_code || '-'}</td>
                        <td className="p-2">{row.department_code || '-'}</td>
                        <td className="p-2 text-right">{formatCurrency(row.unit_price)}</td>
                        <td className="p-2">
                          {row.errors.length === 0 ? (
                            <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                              <CheckCircle2 className="h-3.5 w-3.5" /> พร้อมนำเข้า
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-rose-600 font-medium">
                              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                              {row.errors.join(', ')}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsImportOpen(false)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700"
                >
                  ยกเลิก
                </button>
                <button
                  type="button"
                  disabled={isImporting || importRows.filter((r) => r.errors.length === 0).length === 0}
                  onClick={confirmImportValidRows}
                  className="inline-flex items-center gap-2 rounded-lg bg-gov-700 px-4 py-2 text-xs font-semibold text-white hover:bg-gov-800 disabled:opacity-50"
                >
                  {isImporting && <Loader2 className="h-4 w-4 animate-spin" />}
                  ยืนยันนำเข้ารายการที่ถูกต้อง ({importRows.filter((r) => r.errors.length === 0).length} รายการ)
                </button>
              </div>
            </div>
          )}
        </div>
      </Modal>

      {/* Modal ยืนยันการลบครุภัณฑ์ */}
      <Modal
        open={Boolean(deletingAsset)}
        onClose={() => setDeletingAsset(null)}
        title="ยืนยันการลบรายการครุภัณฑ์"
        description="กรุณาตรวจสอบรายละเอียดครุภัณฑ์ก่อนดำเนินการลบ"
        maxWidth="max-w-md"
      >
        {deletingAsset && (
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-xs text-rose-900">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" />
              <div className="space-y-1">
                <p className="font-bold">คุณต้องการลบครุภัณฑ์รายการนี้ใช่หรือไม่?</p>
                <p>
                  เลขครุภัณฑ์: <strong className="font-mono">{deletingAsset.asset_code}</strong>
                </p>
                <p>
                  ชื่อครุภัณฑ์: <strong>{deletingAsset.name}</strong>
                </p>
                <p>
                  ราคาต่อหน่วย: <strong>{formatCurrency(deletingAsset.unit_price)}</strong>
                </p>
              </div>
            </div>

            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-900 leading-relaxed">
              <strong>ตัวเลือกแนะนำ:</strong> หากต้องการซ่อนออกจากหน้าทะเบียนโดยยังเก็บประวัติไว้ตรวจสอบย้อนหลัง สามารถกดปุ่ม{' '}
              <strong>&ldquo;เก็บเข้าแฟ้มประวัติ (Archive)&rdquo;</strong> หรือกด{' '}
              <strong>&ldquo;ยืนยันการลบถาวร&rdquo;</strong> เพื่อลบออกจากฐานข้อมูลทั้งหมด
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 pt-3 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setDeletingAsset(null)}
                disabled={isDeletingAsset}
                className="rounded-lg border border-slate-300 px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={handleArchiveAsset}
                disabled={isDeletingAsset}
                className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-2 text-xs font-semibold text-amber-900 hover:bg-amber-100"
              >
                <Archive className="h-3.5 w-3.5" />
                เก็บเข้าแฟ้มประวัติ
              </button>
              <button
                type="button"
                onClick={handleDeleteAsset}
                disabled={isDeletingAsset}
                className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-rose-700"
              >
                {isDeletingAsset ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
                ยืนยันการลบถาวร
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
