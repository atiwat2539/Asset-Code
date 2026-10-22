import React, { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import {
  Save,
  Database,
  CheckCircle2,
  AlertTriangle,
  Plus,
  Loader2,
  Building2,
  Edit3,
  Trash2,
} from 'lucide-react';
import {
  assertSupabaseConfigured,
  isSupabaseConfigured,
  recordAuditLog,
  supabase,
  supabaseConfigStatus,
} from '@/lib/supabase';
import { translateSupabaseError } from '@/lib/utils';
import { uploadFileToBucket } from '@/lib/storage';
import { useAuth } from '@/features/auth/AuthContext';
import { useCategories, useSystemSettings } from '@/hooks/useMasterData';
import { ConfirmDialog, LoadingState, Modal, PageHeader } from '@/components/ui/common';
import type { AssetCategory } from '@/types/database';

const settingsSchema = z.object({
  org_name: z.string().min(2, 'กรุณาระบุชื่อหน่วยงาน'),
  org_short_name: z.string().min(1, 'กรุณาระบุชื่อย่อหน่วยงาน'),
  org_address: z.string().optional(),
  org_phone: z.string().optional(),
  org_email: z.string().optional(),
  asset_code_prefix: z.string().min(1, 'กรุณาระบุคำนำหน้ารหัสครุภัณฑ์'),
  asset_code_format: z.string().min(3, 'กรุณาระบุรูปแบบเลขครุภัณฑ์'),
  current_fiscal_year: z.coerce.number().min(2500).max(2700),
  borrow_reminder_days: z.coerce.number().min(1).max(30),
  timezone: z.string().min(1),
  date_format: z.string().min(1),
});

type SettingsFormValues = z.infer<typeof settingsSchema>;

export function SettingsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const configured = isSupabaseConfigured();
  const { data: settings, isLoading } = useSystemSettings();
  const { data: categories = [] } = useCategories();

  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [isCatModalOpen, setIsCatModalOpen] = useState(false);
  const [editingCat, setEditingCat] = useState<AssetCategory | null>(null);
  const [deletingCat, setDeletingCat] = useState<AssetCategory | null>(null);
  const [catCode, setCatCode] = useState('');
  const [catName, setCatName] = useState('');
  const [catLife, setCatLife] = useState(5);
  const [catDepRate, setCatDepRate] = useState(20);
  const [catActive, setCatActive] = useState(true);
  const [isSavingCat, setIsSavingCat] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<SettingsFormValues>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      org_name: 'สำนักงานบริหารงานพัสดุและครุภัณฑ์กลาง',
      org_short_name: 'สบพ.',
      org_address: '',
      org_phone: '',
      org_email: '',
      asset_code_prefix: 'กพท',
      asset_code_format: '{PREFIX}-{CATEGORY}-{YEAR}-{SEQ4}',
      current_fiscal_year: 2569,
      borrow_reminder_days: 3,
      timezone: 'Asia/Bangkok',
      date_format: 'dd MMM BBBB (พ.ศ.)',
    },
  });

  useEffect(() => {
    if (settings) {
      reset({
        org_name: settings.org_name,
        org_short_name: settings.org_short_name,
        org_address: settings.org_address || '',
        org_phone: settings.org_phone || '',
        org_email: settings.org_email || '',
        asset_code_prefix: settings.asset_code_prefix,
        asset_code_format: settings.asset_code_format,
        current_fiscal_year: settings.current_fiscal_year,
        borrow_reminder_days: settings.borrow_reminder_days,
        timezone: settings.timezone,
        date_format: settings.date_format,
      });
    }
  }, [settings, reset]);

  const onSubmitSettings = async (values: SettingsFormValues) => {
    try {
      assertSupabaseConfigured();

      let logoUrl = settings?.logo_url || null;
      if (logoFile) {
        const up = await uploadFileToBucket({
          bucket: 'asset-images',
          folder: 'org-logo',
          file: logoFile,
        });
        logoUrl = up.publicUrl;
      }

      const payload = {
        ...values,
        logo_url: logoUrl,
        updated_by: user?.id || null,
        updated_at: new Date().toISOString(),
      };

      if (settings?.id) {
        const { error } = await supabase
          .from('system_settings')
          .update(payload)
          .eq('id', settings.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('system_settings').insert(payload);
        if (error) throw error;
      }

      await recordAuditLog({
        action: 'SYSTEM_SETTINGS_UPDATED',
        entityType: 'system_settings',
        entityId: settings?.id || 'default',
        summary: `อัปเดตการตั้งค่าระบบของหน่วยงาน (${values.org_name})`,
      });

      toast.success('บันทึกการตั้งค่าระบบเรียบร้อยแล้ว');
      setLogoFile(null);
      queryClient.invalidateQueries({ queryKey: ['system-settings'] });
    } catch (err) {
      toast.error(translateSupabaseError(err));
    }
  };

  const openCreateCategory = () => {
    setEditingCat(null);
    setCatCode('');
    setCatName('');
    setCatLife(5);
    setCatDepRate(20);
    setCatActive(true);
    setIsCatModalOpen(true);
  };

  const openEditCategory = (cat: AssetCategory) => {
    setEditingCat(cat);
    setCatCode(cat.code);
    setCatName(cat.name);
    setCatLife(cat.useful_life_years);
    setCatDepRate(cat.depreciation_rate);
    setCatActive(cat.is_active);
    setIsCatModalOpen(true);
  };

  const handleSaveCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!catCode.trim() || !catName.trim()) {
      toast.error('กรุณาระบุรหัสและชื่อหมวดหมู่ครุภัณฑ์');
      return;
    }

    setIsSavingCat(true);
    try {
      assertSupabaseConfigured();
      if (editingCat) {
        const { error } = await supabase
          .from('asset_categories')
          .update({
            code: catCode.trim(),
            name: catName.trim(),
            useful_life_years: Number(catLife),
            depreciation_rate: Number(catDepRate),
            is_active: catActive,
          })
          .eq('id', editingCat.id);
        if (error) throw error;

        await recordAuditLog({
          action: 'CATEGORY_UPDATED',
          entityType: 'asset_categories',
          entityId: editingCat.id,
          summary: `แก้ไขหมวดหมู่ครุภัณฑ์: ${catCode.trim()} - ${catName.trim()}`,
        });

        toast.success('แก้ไขหมวดหมู่ครุภัณฑ์สำเร็จ');
      } else {
        const { data, error } = await supabase
          .from('asset_categories')
          .insert({
            code: catCode.trim(),
            name: catName.trim(),
            useful_life_years: Number(catLife),
            depreciation_rate: Number(catDepRate),
            is_active: catActive,
          })
          .select('id')
          .single();
        if (error) throw error;

        await recordAuditLog({
          action: 'CATEGORY_CREATED',
          entityType: 'asset_categories',
          entityId: data.id,
          summary: `เพิ่มหมวดหมู่ครุภัณฑ์: ${catCode} - ${catName}`,
        });

        toast.success('เพิ่มหมวดหมู่ครุภัณฑ์ใหม่สำเร็จ');
      }

      setIsCatModalOpen(false);
      setEditingCat(null);
      setCatCode('');
      setCatName('');
      queryClient.invalidateQueries({ queryKey: ['asset_categories'] });
    } catch (err) {
      toast.error(translateSupabaseError(err));
    } finally {
      setIsSavingCat(false);
    }
  };

  const handleDeleteCategory = async () => {
    if (!deletingCat) return;
    try {
      assertSupabaseConfigured();
      const { error } = await supabase
        .from('asset_categories')
        .delete()
        .eq('id', deletingCat.id);
      if (error) throw error;

      await recordAuditLog({
        action: 'CATEGORY_DELETED',
        entityType: 'asset_categories',
        entityId: deletingCat.id,
        summary: `ลบหมวดหมู่ครุภัณฑ์: ${deletingCat.code} - ${deletingCat.name}`,
      });

      toast.success(`ลบหมวดหมู่ "${deletingCat.name}" สำเร็จ`);
      setDeletingCat(null);
      queryClient.invalidateQueries({ queryKey: ['asset_categories'] });
    } catch (err) {
      toast.error(translateSupabaseError(err));
    }
  };

  if (isLoading) {
    return <LoadingState message="กำลังโหลดการตั้งค่าระบบ..." />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="ตั้งค่าระบบบริหารจัดการครุภัณฑ์ (System Configuration)"
        subtitle="กำหนดข้อมูลหน่วยงาน โลโก้ รูปแบบเลขครุภัณฑ์ หมวดหมู่มาตรฐาน นโยบายแจ้งเตือน และตรวจสอบสถานะฐานข้อมูล"
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* ฟอร์มตั้งค่าหลัก */}
        <form
          onSubmit={handleSubmit(onSubmitSettings)}
          className="lg:col-span-2 rounded-xl border border-slate-200 bg-white p-6 shadow-2xs space-y-5"
        >
          <h2 className="text-base font-bold text-slate-900 border-b border-slate-200 pb-3">
            ข้อมูลหน่วยงานและนโยบายระบบ
          </h2>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-700">
                ชื่อหน่วยงานราชการ <span className="text-rose-600">*</span>
              </label>
              <input
                type="text"
                {...register('org_name')}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              {errors.org_name && (
                <p className="mt-1 text-xs text-rose-600">{errors.org_name.message}</p>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">
                ชื่อย่อหน่วยงาน <span className="text-rose-600">*</span>
              </label>
              <input
                type="text"
                {...register('org_short_name')}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">เบอร์โทรศัพท์กลาง</label>
              <input
                type="text"
                {...register('org_phone')}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">อีเมลติดต่อหน่วยงาน</label>
              <input
                type="email"
                {...register('org_email')}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">
                อัปโหลดโลโก้หน่วยงาน (JPG, PNG, WEBP)
              </label>
              <div className="mt-1 flex items-center gap-3">
                {settings?.logo_url ? (
                  <img
                    src={settings.logo_url}
                    alt="โลโก้หน่วยงาน"
                    className="h-10 w-10 rounded border border-slate-200 object-contain"
                  />
                ) : (
                  <div className="flex h-10 w-10 items-center justify-center rounded border border-dashed border-slate-300 text-slate-400">
                    <Building2 className="h-5 w-5" />
                  </div>
                )}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => setLogoFile(e.target.files?.[0] || null)}
                  className="block w-full text-xs text-slate-600 file:mr-2 file:rounded-lg file:border-0 file:bg-slate-800 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white"
                />
              </div>
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-700">สถานที่ตั้ง / ที่อยู่หน่วยงาน</label>
              <input
                type="text"
                {...register('org_address')}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <h3 className="text-sm font-bold text-slate-900 border-t border-slate-200 pt-4">
            การตั้งค่ารหัสครุภัณฑ์ ปีงบประมาณ และการแจ้งเตือน
          </h3>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-slate-700">
                คำนำหน้าเลขครุภัณฑ์ (Prefix)
              </label>
              <input
                type="text"
                {...register('asset_code_prefix')}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">
                รูปแบบมาตรฐานเลขครุภัณฑ์ (ไม่มีผลกระทบเลขครุภัณฑ์เดิมที่บันทึกแล้ว)
              </label>
              <input
                type="text"
                {...register('asset_code_format')}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">
                ปีงบประมาณปัจจุบัน (พ.ศ.)
              </label>
              <input
                type="number"
                {...register('current_fiscal_year')}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">
                แจ้งเตือนล่วงหน้าก่อนครบกำหนดคืนครุภัณฑ์ (วัน)
              </label>
              <input
                type="number"
                {...register('borrow_reminder_days')}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">เขตเวลามาตรฐาน (Timezone)</label>
              <input
                type="text"
                {...register('timezone')}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">รูปแบบการแสดงวันที่</label>
              <input
                type="text"
                {...register('date_format')}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="flex justify-end pt-3 border-t border-slate-200">
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex items-center gap-2 rounded-lg bg-gov-700 px-5 py-2.5 text-xs font-semibold text-white hover:bg-gov-800 disabled:opacity-50"
            >
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              บันทึกการตั้งค่าระบบ
            </button>
          </div>
        </form>

        {/* สถานะการเชื่อมต่อและหมวดหมู่ครุภัณฑ์ */}
        <div className="space-y-6">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs space-y-3">
            <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Database className="h-4 w-4 text-gov-700" />
              สถานะระบบและการเชื่อมต่อฐานข้อมูล
            </h2>
            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between rounded-lg bg-slate-50 p-2.5">
                <span className="text-slate-600">เวอร์ชันแอปพลิเคชัน:</span>
                <span className="font-mono font-semibold text-slate-900">v1.0.0 (Production Ready)</span>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-slate-50 p-2.5">
                <span className="text-slate-600">การเชื่อมต่อ Supabase:</span>
                {configured ? (
                  <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
                    <CheckCircle2 className="h-4 w-4" /> เชื่อมต่อแล้ว
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 font-semibold text-amber-700">
                    <AlertTriangle className="h-4 w-4" /> รอตั้งค่า .env.local
                  </span>
                )}
              </div>
              <div className="rounded-lg bg-slate-50 p-2.5">
                <p className="text-slate-500">Supabase Project Endpoint:</p>
                <p className="mt-0.5 font-mono text-[11px] text-slate-800 truncate">
                  {supabaseConfigStatus.url || 'ยังไม่ได้กำหนด VITE_SUPABASE_URL'}
                </p>
              </div>
              <p className="text-[11px] text-slate-400">
                * ระบบไม่แสดงและไม่จัดเก็บ Secret Key / Service Role Key ในฝั่ง Browser
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-900">หมวดหมู่ครุภัณฑ์ ({categories.length})</h2>
              <button
                type="button"
                onClick={openCreateCategory}
                className="inline-flex items-center gap-1 rounded-lg bg-gov-50 px-2.5 py-1 text-xs font-semibold text-gov-700 hover:bg-gov-100"
              >
                <Plus className="h-3.5 w-3.5" />
                เพิ่มหมวดหมู่
              </button>
            </div>

            <div className="divide-y divide-slate-100 max-h-72 overflow-y-auto text-xs">
              {categories.map((cat) => (
                <div key={cat.id} className="py-2 flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <span className="font-mono font-bold text-gov-700">{cat.code}</span> —{' '}
                    <span className={`font-medium ${cat.is_active ? 'text-slate-800' : 'text-slate-400 line-through'}`}>
                      {cat.name}
                    </span>
                    <span className="ml-2 text-[11px] text-slate-400">
                      ({cat.useful_life_years} ปี / {cat.depreciation_rate}%)
                    </span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => openEditCategory(cat)}
                      className="rounded-md p-1 text-slate-600 hover:bg-slate-100"
                      title="แก้ไขหมวดหมู่"
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeletingCat(cat)}
                      className="rounded-md p-1 text-rose-600 hover:bg-rose-50"
                      title="ลบหมวดหมู่"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Modal เพิ่ม/แก้ไขหมวดหมู่ครุภัณฑ์ */}
      <Modal
        open={isCatModalOpen}
        onClose={() => {
          setIsCatModalOpen(false);
          setEditingCat(null);
        }}
        title={editingCat ? 'แก้ไขหมวดหมู่ครุภัณฑ์มาตรฐาน' : 'เพิ่มหมวดหมู่ครุภัณฑ์มาตรฐาน'}
        maxWidth="max-w-md"
      >
        <form onSubmit={handleSaveCategory} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700">รหัสหมวดหมู่พัสดุ *</label>
            <input
              type="text"
              value={catCode}
              onChange={(e) => setCatCode(e.target.value)}
              placeholder="เช่น 7440"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700">ชื่อหมวดหมู่ครุภัณฑ์ *</label>
            <input
              type="text"
              value={catName}
              onChange={(e) => setCatName(e.target.value)}
              placeholder="เช่น ครุภัณฑ์คอมพิวเตอร์"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700">อายุการใช้งาน (ปี)</label>
              <input
                type="number"
                value={catLife}
                onChange={(e) => setCatLife(Number(e.target.value))}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700">อัตราค่าเสื่อม (%/ปี)</label>
              <input
                type="number"
                step="0.01"
                value={catDepRate}
                onChange={(e) => setCatDepRate(Number(e.target.value))}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <input
              id="cat-active"
              type="checkbox"
              checked={catActive}
              onChange={(e) => setCatActive(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-gov-700"
            />
            <label htmlFor="cat-active" className="text-xs font-semibold text-slate-700">
              เปิดใช้งานหมวดหมู่นี้
            </label>
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
            <button
              type="button"
              onClick={() => {
                setIsCatModalOpen(false);
                setEditingCat(null);
              }}
              className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={isSavingCat}
              className="inline-flex items-center gap-1.5 rounded-lg bg-gov-700 px-4 py-2 text-xs font-semibold text-white"
            >
              {isSavingCat && <Loader2 className="h-4 w-4 animate-spin" />}
              บันทึกหมวดหมู่
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(deletingCat)}
        onClose={() => setDeletingCat(null)}
        onConfirm={handleDeleteCategory}
        title="ยืนยันการลบหมวดหมู่ครุภัณฑ์"
        description={`คุณต้องการลบหมวดหมู่ "${deletingCat?.code} - ${deletingCat?.name}" ออกจากระบบใช่หรือไม่? (หากมีครุภัณฑ์ผูกกับหมวดหมู่นี้อยู่ ระบบอาจไม่อนุญาตให้ลบ)`}
        confirmLabel="ยืนยันลบหมวดหมู่"
      />
    </div>
  );
}
