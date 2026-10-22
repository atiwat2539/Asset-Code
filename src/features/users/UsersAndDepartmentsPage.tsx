import React, { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Users,
  Building2,
  MapPin,
  Plus,
  Edit3,
  ShieldCheck,
  Loader2,
  Info,
  UserPlus,
  Trash2,
  Search,
  AlertTriangle,
  Ban,
} from 'lucide-react';
import {
  assertSupabaseConfigured,
  createIsolatedAuthClient,
  recordAuditLog,
  supabase,
} from '@/lib/supabase';
import { ROLE_LABELS, translateSupabaseError } from '@/lib/utils';
import { useDepartments, useLocations, useProfiles } from '@/hooks/useMasterData';
import { useAuth } from '@/features/auth/AuthContext';
import { LoadingState, Modal, PageHeader, StatusBadge } from '@/components/ui/common';
import type { Profile, UserRole } from '@/types/database';

export function UsersAndDepartmentsPage() {
  const queryClient = useQueryClient();
  const { user: currentUser, refreshProfile } = useAuth();
  const { data: profiles = [], isLoading: loadingProfiles } = useProfiles();
  const { data: departments = [], isLoading: loadingDepts } = useDepartments();
  const { data: locations = [], isLoading: loadingLocs } = useLocations();

  const [activeTab, setActiveTab] = useState<'users' | 'departments' | 'locations'>('users');
  const [userSearch, setUserSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');

  // Edit User State (แก้ไขข้อมูลและบทบาทผู้ใช้งาน)
  const [editingProfile, setEditingProfile] = useState<Profile | null>(null);
  const [editFullName, setEditFullName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [selectedRole, setSelectedRole] = useState<UserRole>('requester');
  const [selectedDeptId, setSelectedDeptId] = useState('');
  const [positionText, setPositionText] = useState('');
  const [isActiveUser, setIsActiveUser] = useState(true);
  const [isSavingUser, setIsSavingUser] = useState(false);

  // Delete User State (ลบผู้ใช้งาน)
  const [deletingProfile, setDeletingProfile] = useState<Profile | null>(null);
  const [isDeletingUser, setIsDeletingUser] = useState(false);

  // Create User State (Admin สร้างบัญชีให้บุคลากรโดยตรง)
  const [isCreateUserModalOpen, setIsCreateUserModalOpen] = useState(false);
  const [newUserFullName, setNewUserFullName] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [newUserPhone, setNewUserPhone] = useState('');
  const [newUserRole, setNewUserRole] = useState<UserRole>('requester');
  const [newUserDeptId, setNewUserDeptId] = useState('');
  const [newUserPosition, setNewUserPosition] = useState('');
  const [isCreatingUser, setIsCreatingUser] = useState(false);

  // Create Department State
  const [isDeptModalOpen, setIsDeptModalOpen] = useState(false);
  const [deptCode, setDeptCode] = useState('');
  const [deptName, setDeptName] = useState('');
  const [deptPhone, setDeptPhone] = useState('');
  const [isSavingDept, setIsSavingDept] = useState(false);

  // Create Location State
  const [isLocModalOpen, setIsLocModalOpen] = useState(false);
  const [locCode, setLocCode] = useState('');
  const [locBuilding, setLocBuilding] = useState('');
  const [locFloor, setLocFloor] = useState('');
  const [locRoom, setLocRoom] = useState('');
  const [locName, setLocName] = useState('');
  const [locDeptId, setLocDeptId] = useState('');
  const [isSavingLoc, setIsSavingLoc] = useState(false);

  const filteredProfiles = useMemo(() => {
    return profiles.filter((p) => {
      const q = userSearch.trim().toLowerCase();
      const matchesSearch =
        !q ||
        p.full_name.toLowerCase().includes(q) ||
        p.email.toLowerCase().includes(q) ||
        (p.position || '').toLowerCase().includes(q) ||
        (p.department?.name || '').toLowerCase().includes(q);
      const matchesRole = roleFilter === 'all' || p.role === roleFilter;
      return matchesSearch && matchesRole;
    });
  }, [profiles, userSearch, roleFilter]);

  const openEditUser = (p: Profile) => {
    setEditingProfile(p);
    setEditFullName(p.full_name || '');
    setEditPhone(p.phone || '');
    setSelectedRole(p.role);
    setSelectedDeptId(p.department_id || '');
    setPositionText(p.position || '');
    setIsActiveUser(p.is_active);
  };

  const handleSaveUserRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProfile) return;
    if (!editFullName.trim()) {
      toast.error('กรุณากรอกชื่อ-นามสกุลของผู้ใช้งาน');
      return;
    }

    setIsSavingUser(true);
    try {
      assertSupabaseConfigured();
      const cleanName = editFullName.trim();
      const cleanPhone = editPhone.trim() || null;
      const cleanPosition = positionText.trim() || null;
      const cleanDeptId = selectedDeptId || null;

      // 1. อัปเดตข้อมูลโปรไฟล์ทั้งหมดผ่านตาราง profiles (ภายใต้ RLS Policy ของ Admin)
      const { error: updateError } = await supabase
        .from('profiles')
        .update({
          full_name: cleanName,
          phone: cleanPhone,
          position: cleanPosition,
          department_id: cleanDeptId,
          role: selectedRole,
          is_active: isActiveUser,
        })
        .eq('id', editingProfile.id);

      if (updateError) {
        // Fallback เรียกใช้ RPC admin_update_user_role
        const { error: rpcError } = await supabase.rpc('admin_update_user_role', {
          p_target_user_id: editingProfile.id,
          p_new_role: selectedRole,
          p_department_id: cleanDeptId,
          p_position: cleanPosition,
          p_is_active: isActiveUser,
        });
        if (rpcError) throw rpcError;
      } else {
        await recordAuditLog({
          action: 'USER_UPDATED',
          entityType: 'profiles',
          entityId: editingProfile.id,
          summary: `แก้ไขข้อมูลผู้ใช้งาน ${cleanName} (${editingProfile.email}) สิทธิ์: ${selectedRole}`,
          beforeData: {
            full_name: editingProfile.full_name,
            role: editingProfile.role,
            department_id: editingProfile.department_id,
            position: editingProfile.position,
            phone: editingProfile.phone,
            is_active: editingProfile.is_active,
          },
          afterData: {
            full_name: cleanName,
            role: selectedRole,
            department_id: cleanDeptId,
            position: cleanPosition,
            phone: cleanPhone,
            is_active: isActiveUser,
          },
        });
      }

      if (editingProfile.id === currentUser?.id) {
        await refreshProfile();
      }

      toast.success(`บันทึกการแก้ไขข้อมูลของ ${cleanName} สำเร็จ`);
      setEditingProfile(null);
      queryClient.invalidateQueries({ queryKey: ['profiles'] });
      queryClient.invalidateQueries({ queryKey: ['audit-logs-list'] });
    } catch (err) {
      toast.error(translateSupabaseError(err));
    } finally {
      setIsSavingUser(false);
    }
  };

  const handleDeleteUser = async () => {
    if (!deletingProfile) return;

    if (deletingProfile.id === currentUser?.id) {
      toast.error('ไม่สามารถลบบัญชีของตนเองที่กำลังเข้าสู่ระบบอยู่ได้');
      return;
    }

    setIsDeletingUser(true);
    try {
      assertSupabaseConfigured();

      // 1. ลองเรียก RPC admin_delete_user (ลบทั้ง profiles และ auth.users)
      const { error: rpcError } = await supabase.rpc('admin_delete_user', {
        p_target_user_id: deletingProfile.id,
      });

      if (rpcError) {
        // 2. Fallback ลบจากตาราง profiles โดยตรงหากยังไม่ได้อัปเดตฟังก์ชัน RPC ในฐานข้อมูล
        const { error: deleteError } = await supabase
          .from('profiles')
          .delete()
          .eq('id', deletingProfile.id);

        if (deleteError) throw deleteError;

        await recordAuditLog({
          action: 'USER_DELETED',
          entityType: 'profiles',
          entityId: deletingProfile.id,
          summary: `ลบบัญชีผู้ใช้งาน ${deletingProfile.full_name} (${deletingProfile.email}) ออกจากระบบ`,
        });
      }

      toast.success(`ลบผู้ใช้งาน ${deletingProfile.full_name} ออกจากระบบเรียบร้อยแล้ว`);
      setDeletingProfile(null);
      queryClient.invalidateQueries({ queryKey: ['profiles'] });
      queryClient.invalidateQueries({ queryKey: ['audit-logs-list'] });
    } catch (err) {
      toast.error(translateSupabaseError(err));
    } finally {
      setIsDeletingUser(false);
    }
  };

  const handleSuspendInsteadOfDelete = async () => {
    if (!deletingProfile) return;

    setIsDeletingUser(true);
    try {
      assertSupabaseConfigured();
      const { error } = await supabase
        .from('profiles')
        .update({ is_active: false })
        .eq('id', deletingProfile.id);

      if (error) throw error;

      await recordAuditLog({
        action: 'USER_SUSPENDED',
        entityType: 'profiles',
        entityId: deletingProfile.id,
        summary: `ระงับการใช้งานบัญชีผู้ใช้ ${deletingProfile.full_name} (${deletingProfile.email})`,
      });

      toast.success(`ระงับสิทธิ์การใช้งานของ ${deletingProfile.full_name} เรียบร้อยแล้ว`);
      setDeletingProfile(null);
      queryClient.invalidateQueries({ queryKey: ['profiles'] });
      queryClient.invalidateQueries({ queryKey: ['audit-logs-list'] });
    } catch (err) {
      toast.error(translateSupabaseError(err));
    } finally {
      setIsDeletingUser(false);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUserFullName.trim() || !newUserEmail.trim() || newUserPassword.length < 6) {
      toast.error('กรุณากรอกชื่อ-นามสกุล อีเมล และรหัสผ่าน (อย่างน้อย 6 ตัวอักษร) ให้ครบถ้วน');
      return;
    }

    setIsCreatingUser(true);
    try {
      assertSupabaseConfigured();
      const isolatedClient = createIsolatedAuthClient();
      const cleanEmail = newUserEmail.trim().toLowerCase();
      const cleanName = newUserFullName.trim();
      const cleanPosition = newUserPosition.trim() || null;
      const cleanPhone = newUserPhone.trim() || null;

      const { data, error } = await isolatedClient.auth.signUp({
        email: cleanEmail,
        password: newUserPassword,
        options: {
          data: {
            full_name: cleanName,
            position: cleanPosition,
          },
        },
      });

      if (error) throw error;

      if (data.user) {
        await supabase
          .from('profiles')
          .update({
            full_name: cleanName,
            phone: cleanPhone,
            position: cleanPosition,
            department_id: newUserDeptId || null,
            role: newUserRole,
            is_active: true,
          })
          .eq('id', data.user.id);

        await recordAuditLog({
          action: 'USER_CREATED_BY_ADMIN',
          entityType: 'profiles',
          entityId: data.user.id,
          summary: `ผู้ดูแลระบบสร้างบัญชีใหม่: ${cleanName} (${cleanEmail}) สิทธิ์ ${newUserRole}`,
        });
      }

      toast.success(`สร้างบัญชีผู้ใช้งาน ${cleanName} (${cleanEmail}) สำเร็จ`);
      setIsCreateUserModalOpen(false);
      setNewUserFullName('');
      setNewUserEmail('');
      setNewUserPassword('');
      setNewUserPhone('');
      setNewUserRole('requester');
      setNewUserDeptId('');
      setNewUserPosition('');
      queryClient.invalidateQueries({ queryKey: ['profiles'] });
      queryClient.invalidateQueries({ queryKey: ['audit-logs-list'] });
    } catch (err) {
      toast.error(translateSupabaseError(err));
    } finally {
      setIsCreatingUser(false);
    }
  };

  const handleCreateDepartment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deptCode.trim() || !deptName.trim()) {
      toast.error('กรุณากรอกรหัสและชื่อหน่วยงาน');
      return;
    }

    setIsSavingDept(true);
    try {
      assertSupabaseConfigured();
      const { data, error } = await supabase
        .from('departments')
        .insert({
          code: deptCode.trim().toUpperCase(),
          name: deptName.trim(),
          phone: deptPhone.trim() || null,
          is_active: true,
        })
        .select('id')
        .single();

      if (error) throw error;

      await recordAuditLog({
        action: 'DEPARTMENT_CREATED',
        entityType: 'departments',
        entityId: data.id,
        summary: `เพิ่มหน่วยงานใหม่: ${deptCode.toUpperCase()} - ${deptName}`,
      });

      toast.success('เพิ่มหน่วยงาน/กองใหม่เรียบร้อยแล้ว');
      setIsDeptModalOpen(false);
      setDeptCode('');
      setDeptName('');
      setDeptPhone('');
      queryClient.invalidateQueries({ queryKey: ['departments'] });
    } catch (err) {
      toast.error(translateSupabaseError(err));
    } finally {
      setIsSavingDept(false);
    }
  };

  const handleCreateLocation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!locCode.trim() || !locBuilding.trim() || !locName.trim()) {
      toast.error('กรุณากรอกรหัสสถานที่ อาคาร และชื่อสถานที่');
      return;
    }

    setIsSavingLoc(true);
    try {
      assertSupabaseConfigured();
      const { data, error } = await supabase
        .from('locations')
        .insert({
          code: locCode.trim().toUpperCase(),
          building: locBuilding.trim(),
          floor: locFloor.trim() || null,
          room: locRoom.trim() || null,
          name: locName.trim(),
          department_id: locDeptId || null,
          is_active: true,
        })
        .select('id')
        .single();

      if (error) throw error;

      await recordAuditLog({
        action: 'LOCATION_CREATED',
        entityType: 'locations',
        entityId: data.id,
        summary: `เพิ่มสถานที่ตั้งใหม่: ${locBuilding} ห้อง ${locRoom || '-'} (${locName})`,
      });

      toast.success('เพิ่มอาคาร/ห้อง/สถานที่ตั้งใหม่สำเร็จ');
      setIsLocModalOpen(false);
      setLocCode('');
      setLocBuilding('');
      setLocFloor('');
      setLocRoom('');
      setLocName('');
      queryClient.invalidateQueries({ queryKey: ['locations'] });
    } catch (err) {
      toast.error(translateSupabaseError(err));
    } finally {
      setIsSavingLoc(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="จัดการผู้ใช้ บทบาท หน่วยงาน และสถานที่ตั้ง"
        subtitle="เพิ่ม แก้ไข ระงับ หรือลบบัญชีผู้ใช้งาน พร้อมกำหนดบทบาทสิทธิ์และจัดการโครงสร้างหน่วยงาน"
      />

      {/* คำแนะนำการจัดการผู้ใช้ */}
      <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-xs text-sky-950 flex items-start gap-3">
        <Info className="mt-0.5 h-5 w-5 shrink-0 text-sky-700" />
        <div>
          <p className="font-bold">การบริหารจัดการบัญชีบุคลากรและสิทธิ์การเข้าถึง (Admin Controls):</p>
          <p className="mt-0.5 text-sky-900">
            ผู้ดูแลระบบสามารถกดปุ่ม <strong>+ สร้างบัญชีผู้ใช้งานใหม่</strong> ด้านล่าง หรือกดปุ่ม{' '}
            <strong>แก้ไข</strong> เพื่อเปลี่ยนชื่อ-นามสกุล เบอร์โทรศัพท์ ตำแหน่ง หน่วยงานสังกัด และระดับสิทธิ์ (
            <code className="rounded bg-sky-200/70 px-1 py-0.5 font-mono">admin</code>,{' '}
            <code className="rounded bg-sky-200/70 px-1 py-0.5 font-mono">asset_officer</code>,{' '}
            <code className="rounded bg-sky-200/70 px-1 py-0.5 font-mono">requester</code>) รวมถึงกดปุ่ม{' '}
            <strong>ลบ</strong> หรือระงับการใช้งานบัญชีได้ทันที
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 pt-2 rounded-t-xl shadow-2xs">
        <div className="flex space-x-2">
          <button
            type="button"
            onClick={() => setActiveTab('users')}
            className={`inline-flex items-center gap-2 border-b-2 px-4 py-3 text-xs font-semibold ${
              activeTab === 'users'
                ? 'border-gov-700 text-gov-700'
                : 'border-transparent text-slate-600'
            }`}
          >
            <Users className="h-4 w-4" />
            บุคลากรและสิทธิ์ผู้ใช้งาน ({profiles.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('departments')}
            className={`inline-flex items-center gap-2 border-b-2 px-4 py-3 text-xs font-semibold ${
              activeTab === 'departments'
                ? 'border-gov-700 text-gov-700'
                : 'border-transparent text-slate-600'
            }`}
          >
            <Building2 className="h-4 w-4" />
            หน่วยงาน / กอง / สำนัก ({departments.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('locations')}
            className={`inline-flex items-center gap-2 border-b-2 px-4 py-3 text-xs font-semibold ${
              activeTab === 'locations'
                ? 'border-gov-700 text-gov-700'
                : 'border-transparent text-slate-600'
            }`}
          >
            <MapPin className="h-4 w-4" />
            อาคาร / ชั้น / ห้อง ({locations.length})
          </button>
        </div>

        <div className="pb-2">
          {activeTab === 'users' && (
            <button
              type="button"
              onClick={() => setIsCreateUserModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-gov-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-gov-800"
            >
              <UserPlus className="h-4 w-4" />
              สร้างบัญชีผู้ใช้งานใหม่
            </button>
          )}
          {activeTab === 'departments' && (
            <button
              type="button"
              onClick={() => setIsDeptModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-gov-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-gov-800"
            >
              <Plus className="h-4 w-4" />
              เพิ่มหน่วยงาน
            </button>
          )}
          {activeTab === 'locations' && (
            <button
              type="button"
              onClick={() => setIsLocModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-gov-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-gov-800"
            >
              <Plus className="h-4 w-4" />
              เพิ่มอาคาร/ห้อง
            </button>
          )}
        </div>
      </div>

      {/* Tab Content */}
      <div className="rounded-b-xl border border-t-0 border-slate-200 bg-white shadow-2xs overflow-hidden">
        {activeTab === 'users' && (
          <div>
            {/* แถบค้นหาและกรองผู้ใช้งาน */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50/70 p-3.5">
              <div className="relative flex-1 min-w-[240px]">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <input
                  type="text"
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  placeholder="ค้นหาชื่อ-นามสกุล, อีเมล, ตำแหน่ง หรือหน่วยงาน..."
                  className="w-full rounded-lg border border-slate-300 bg-white py-1.5 pl-9 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-gov-600 focus:outline-none"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs font-medium text-slate-600">กรองตามสิทธิ์:</label>
                <select
                  value={roleFilter}
                  onChange={(e) => setRoleFilter(e.target.value)}
                  className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700"
                >
                  <option value="all">ทั้งหมด ({profiles.length})</option>
                  <option value="admin">ผู้ดูแลระบบ (Admin)</option>
                  <option value="asset_officer">เจ้าหน้าที่พัสดุ (Asset Officer)</option>
                  <option value="requester">บุคลากรทั่วไป (Requester)</option>
                </select>
              </div>
            </div>

            {loadingProfiles ? (
              <LoadingState message="กำลังโหลดรายชื่อผู้ใช้งาน..." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs font-semibold text-slate-600 border-b border-slate-200">
                    <tr>
                      <th className="p-3.5">ชื่อ-นามสกุล</th>
                      <th className="p-3.5">อีเมล / เบอร์โทร</th>
                      <th className="p-3.5">ตำแหน่ง</th>
                      <th className="p-3.5">หน่วยงานสังกัด</th>
                      <th className="p-3.5">บทบาทสิทธิ์ (Role)</th>
                      <th className="p-3.5">สถานะบัญชี</th>
                      <th className="p-3.5 text-right">จัดการผู้ใช้งาน</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-xs">
                    {filteredProfiles.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="p-8 text-center text-slate-500">
                          ไม่พบข้อมูลผู้ใช้งานที่ตรงกับเงื่อนไขการค้นหา
                        </td>
                      </tr>
                    ) : (
                      filteredProfiles.map((p) => {
                        const isSelf = p.id === currentUser?.id;
                        return (
                          <tr key={p.id} className="hover:bg-slate-50">
                            <td className="p-3.5">
                              <div className="font-semibold text-slate-900">
                                {p.full_name}
                                {isSelf && (
                                  <span className="ml-1.5 rounded bg-gov-100 px-1.5 py-0.5 text-[10px] font-bold text-gov-800">
                                    คุณ
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="p-3.5">
                              <div className="font-mono text-slate-700">{p.email}</div>
                              {p.phone && (
                                <div className="text-[11px] text-slate-500">โทร: {p.phone}</div>
                              )}
                            </td>
                            <td className="p-3.5 text-slate-600">{p.position || '-'}</td>
                            <td className="p-3.5 text-slate-600">{p.department?.name || '-'}</td>
                            <td className="p-3.5">
                              <StatusBadge
                                label={ROLE_LABELS[p.role]?.label || p.role}
                                className={ROLE_LABELS[p.role]?.badgeClass}
                              />
                            </td>
                            <td className="p-3.5">
                              <StatusBadge
                                label={p.is_active ? 'ปกติ (Active)' : 'ระงับสิทธิ์'}
                                className={
                                  p.is_active
                                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                    : 'bg-rose-50 text-rose-800 border-rose-200'
                                }
                              />
                            </td>
                            <td className="p-3.5 text-right">
                              <div className="inline-flex items-center justify-end gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => openEditUser(p)}
                                  className="inline-flex items-center gap-1 rounded-lg bg-gov-700 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-gov-800"
                                  title="แก้ไขข้อมูลและกำหนดสิทธิ์ผู้ใช้งาน"
                                >
                                  <Edit3 className="h-3.5 w-3.5" />
                                  แก้ไข
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setDeletingProfile(p)}
                                  disabled={isSelf}
                                  className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-40"
                                  title={
                                    isSelf
                                      ? 'ไม่สามารถลบบัญชีของตนเองได้'
                                      : 'ลบบัญชีผู้ใช้งานออกจากระบบ'
                                  }
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                  ลบ
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {activeTab === 'departments' && (
          loadingDepts ? (
            <LoadingState message="กำลังโหลดข้อมูลหน่วยงาน..." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs font-semibold text-slate-600 border-b border-slate-200">
                  <tr>
                    <th className="p-3.5">รหัสหน่วยงาน</th>
                    <th className="p-3.5">ชื่อหน่วยงาน / กอง / สำนัก</th>
                    <th className="p-3.5">เบอร์โทรศัพท์ติดต่อ</th>
                    <th className="p-3.5">สถานะ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-xs">
                  {departments.map((d) => (
                    <tr key={d.id} className="hover:bg-slate-50">
                      <td className="p-3.5 font-mono font-bold text-gov-700">{d.code}</td>
                      <td className="p-3.5 font-semibold text-slate-900">{d.name}</td>
                      <td className="p-3.5 text-slate-600">{d.phone || '-'}</td>
                      <td className="p-3.5">
                        <StatusBadge
                          label={d.is_active ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}
                          className="bg-emerald-50 text-emerald-800 border-emerald-200"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}

        {activeTab === 'locations' && (
          loadingLocs ? (
            <LoadingState message="กำลังโหลดข้อมูลสถานที่ตั้ง..." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs font-semibold text-slate-600 border-b border-slate-200">
                  <tr>
                    <th className="p-3.5">รหัสสถานที่</th>
                    <th className="p-3.5">อาคาร</th>
                    <th className="p-3.5">ชั้น / ห้อง</th>
                    <th className="p-3.5">ชื่อห้อง / สถานที่ตั้ง</th>
                    <th className="p-3.5">หน่วยงานที่ดูแล</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-xs">
                  {locations.map((loc) => (
                    <tr key={loc.id} className="hover:bg-slate-50">
                      <td className="p-3.5 font-mono font-bold text-gov-700">{loc.code}</td>
                      <td className="p-3.5 font-medium text-slate-900">{loc.building}</td>
                      <td className="p-3.5 text-slate-600">
                        ชั้น {loc.floor || '-'} / ห้อง {loc.room || '-'}
                      </td>
                      <td className="p-3.5 font-semibold text-slate-900">{loc.name}</td>
                      <td className="p-3.5 text-slate-600">{loc.department?.name || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>

      {/* Modal สร้างบัญชีผู้ใช้งานใหม่โดย Admin */}
      <Modal
        open={isCreateUserModalOpen}
        onClose={() => setIsCreateUserModalOpen(false)}
        title="สร้างบัญชีผู้ใช้งานใหม่"
        description="เพิ่มบัญชีบุคลากรเข้าสู่ระบบพร้อมกำหนดระดับสิทธิ์และหน่วยงานสังกัดทันที"
      >
        <form onSubmit={handleCreateUser} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-slate-700">ชื่อ-นามสกุล *</label>
              <input
                type="text"
                value={newUserFullName}
                onChange={(e) => setNewUserFullName(e.target.value)}
                placeholder="เช่น นางสาวสุดา พัสดุดี"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700">อีเมลผู้ใช้งาน (Email) *</label>
              <input
                type="email"
                value={newUserEmail}
                onChange={(e) => setNewUserEmail(e.target.value)}
                placeholder="suda@agency.go.th"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-slate-700">
                รหัสผ่านเริ่มต้น (อย่างน้อย 6 ตัวอักษร) *
              </label>
              <input
                type="password"
                value={newUserPassword}
                onChange={(e) => setNewUserPassword(e.target.value)}
                placeholder="••••••••"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700">เบอร์โทรศัพท์ติดต่อ</label>
              <input
                type="text"
                value={newUserPhone}
                onChange={(e) => setNewUserPhone(e.target.value)}
                placeholder="เช่น 081-234-5678"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-slate-700">ตำแหน่งราชการ</label>
              <input
                type="text"
                value={newUserPosition}
                onChange={(e) => setNewUserPosition(e.target.value)}
                placeholder="เช่น นักวิชาการพัสดุปฏิบัติการ"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700">หน่วยงานสังกัด</label>
              <select
                value={newUserDeptId}
                onChange={(e) => setNewUserDeptId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                <option value="">-- ไม่ระบุหน่วยงาน --</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.code} - {d.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700">ระดับสิทธิ์ (Role)</label>
            <select
              value={newUserRole}
              onChange={(e) => setNewUserRole(e.target.value as UserRole)}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold"
            >
              {Object.entries(ROLE_LABELS).map(([key, meta]) => (
                <option key={key} value={key}>
                  {meta.label} — {meta.description}
                </option>
              ))}
            </select>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
            <button
              type="button"
              onClick={() => setIsCreateUserModalOpen(false)}
              className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={isCreatingUser}
              className="inline-flex items-center gap-1.5 rounded-lg bg-gov-700 px-4 py-2 text-xs font-semibold text-white hover:bg-gov-800"
            >
              {isCreatingUser ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <UserPlus className="h-4 w-4" />
              )}
              สร้างบัญชีผู้ใช้งาน
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal แก้ไขข้อมูลและกำหนดบทบาทผู้ใช้ */}
      <Modal
        open={Boolean(editingProfile)}
        onClose={() => setEditingProfile(null)}
        title={`แก้ไขข้อมูลผู้ใช้งาน: ${editingProfile?.full_name || ''}`}
        description="แก้ไขข้อมูลส่วนตัว หน่วยงานสังกัด ระดับสิทธิ์ (Role) และสถานะการใช้งานบัญชี"
      >
        {editingProfile && (
          <form onSubmit={handleSaveUserRole} className="space-y-4">
            <div className="rounded-lg bg-slate-50 p-3 text-xs border border-slate-200 flex items-center justify-between">
              <span>
                อีเมลผู้ใช้งาน: <strong className="font-mono">{editingProfile.email}</strong>
              </span>
              <span className="text-[11px] text-slate-500">รหัสอ้างอิง: {editingProfile.id.slice(0, 8)}</span>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-semibold text-slate-700">ชื่อ-นามสกุล *</label>
                <input
                  type="text"
                  value={editFullName}
                  onChange={(e) => setEditFullName(e.target.value)}
                  placeholder="ระบุชื่อ-นามสกุล"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">เบอร์โทรศัพท์ติดต่อ</label>
                <input
                  type="text"
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  placeholder="เช่น 081-234-5678"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-semibold text-slate-700">หน่วยงานสังกัด</label>
                <select
                  value={selectedDeptId}
                  onChange={(e) => setSelectedDeptId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="">-- ไม่ระบุหน่วยงาน --</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.code} - {d.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">ตำแหน่งราชการ</label>
                <input
                  type="text"
                  value={positionText}
                  onChange={(e) => setPositionText(e.target.value)}
                  placeholder="เช่น นักวิชาการพัสดุปฏิบัติการ"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">ระดับสิทธิ์ (Role)</label>
              <select
                value={selectedRole}
                onChange={(e) => setSelectedRole(e.target.value as UserRole)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold"
              >
                {Object.entries(ROLE_LABELS).map(([key, meta]) => (
                  <option key={key} value={key}>
                    {meta.label} — {meta.description}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <input
                id="user-active"
                type="checkbox"
                checked={isActiveUser}
                onChange={(e) => setIsActiveUser(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-gov-700"
              />
              <label htmlFor="user-active" className="text-xs font-medium text-slate-700">
                เปิดใช้งานบัญชีนี้ (หากนำเครื่องหมายออก ผู้ใช้จะถูกระงับสิทธิ์ผ่าน RLS ทันที)
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setEditingProfile(null)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700"
              >
                ยกเลิก
              </button>
              <button
                type="submit"
                disabled={isSavingUser}
                className="inline-flex items-center gap-1.5 rounded-lg bg-gov-700 px-4 py-2 text-xs font-semibold text-white hover:bg-gov-800"
              >
                {isSavingUser ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ShieldCheck className="h-4 w-4" />
                )}
                บันทึกการแก้ไขข้อมูล
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* Modal ยืนยันการลบผู้ใช้งาน */}
      <Modal
        open={Boolean(deletingProfile)}
        onClose={() => setDeletingProfile(null)}
        title="ยืนยันการลบบัญชีผู้ใช้งาน"
        description="กรุณาตรวจสอบข้อมูลผู้ใช้งานก่อนดำเนินการลบออกจากระบบ"
        maxWidth="max-w-md"
      >
        {deletingProfile && (
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-xs text-rose-900">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" />
              <div className="space-y-1">
                <p className="font-bold">คุณกำลังจะลบบัญชีผู้ใช้งานต่อไปนี้:</p>
                <p>
                  ชื่อ-นามสกุล: <strong>{deletingProfile.full_name}</strong>
                </p>
                <p>
                  อีเมล: <strong className="font-mono">{deletingProfile.email}</strong>
                </p>
                <p>
                  บทบาท: <strong>{ROLE_LABELS[deletingProfile.role]?.label}</strong>
                </p>
              </div>
            </div>

            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-900 leading-relaxed">
              <strong>หมายเหตุตามระเบียบงานพัสดุ:</strong> หากผู้ใช้งานรายนี้เคยมีประวัติการยืม-คืน แจ้งซ่อม หรือเสนอจำหน่ายครุภัณฑ์ในฐานข้อมูล ระบบฐานข้อมูลอาจไม่อนุญาตให้ลบถาวรเพื่อรักษาหลักฐานการตรวจสอบ แนะนำให้ใช้ปุ่ม{' '}
              <strong>&ldquo;ระงับการใช้งานบัญชีแทน&rdquo;</strong> เพื่อปิดสิทธิ์การเข้าถึงโดยข้อมูลประวัติเดิมไม่สูญหาย
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 pt-3 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setDeletingProfile(null)}
                disabled={isDeletingUser}
                className="rounded-lg border border-slate-300 px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={handleSuspendInsteadOfDelete}
                disabled={isDeletingUser}
                className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-2 text-xs font-semibold text-amber-900 hover:bg-amber-100"
              >
                <Ban className="h-3.5 w-3.5" />
                ระงับการใช้งานบัญชีแทน
              </button>
              <button
                type="button"
                onClick={handleDeleteUser}
                disabled={isDeletingUser}
                className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-rose-700"
              >
                {isDeletingUser ? (
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

      {/* Modal เพิ่มหน่วยงาน */}
      <Modal
        open={isDeptModalOpen}
        onClose={() => setIsDeptModalOpen(false)}
        title="เพิ่มหน่วยงาน / กอง / สำนักใหม่"
        maxWidth="max-w-md"
      >
        <form onSubmit={handleCreateDepartment} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700">รหัสหน่วยงาน (Code) *</label>
            <input
              type="text"
              value={deptCode}
              onChange={(e) => setDeptCode(e.target.value)}
              placeholder="เช่น HRD, FIN"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono uppercase"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700">ชื่อหน่วยงาน *</label>
            <input
              type="text"
              value={deptName}
              onChange={(e) => setDeptName(e.target.value)}
              placeholder="เช่น กองการเจ้าหน้าที่"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700">เบอร์โทรศัพท์ภายใน</label>
            <input
              type="text"
              value={deptPhone}
              onChange={(e) => setDeptPhone(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
            <button
              type="button"
              onClick={() => setIsDeptModalOpen(false)}
              className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={isSavingDept}
              className="inline-flex items-center gap-1.5 rounded-lg bg-gov-700 px-4 py-2 text-xs font-semibold text-white"
            >
              {isSavingDept && <Loader2 className="h-4 w-4 animate-spin" />}
              บันทึกหน่วยงาน
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal เพิ่มสถานที่ตั้ง */}
      <Modal
        open={isLocModalOpen}
        onClose={() => setIsLocModalOpen(false)}
        title="เพิ่มอาคาร / ห้อง / สถานที่ตั้งครุภัณฑ์"
        maxWidth="max-w-md"
      >
        <form onSubmit={handleCreateLocation} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700">รหัสสถานที่ *</label>
            <input
              type="text"
              value={locCode}
              onChange={(e) => setLocCode(e.target.value)}
              placeholder="เช่น BLD-A-301"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono uppercase"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700">ชื่ออาคาร *</label>
            <input
              type="text"
              value={locBuilding}
              onChange={(e) => setLocBuilding(e.target.value)}
              placeholder="เช่น อาคารอำนวยการ A"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700">ชั้น (Floor)</label>
              <input
                type="text"
                value={locFloor}
                onChange={(e) => setLocFloor(e.target.value)}
                placeholder="เช่น 3"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700">เลขห้อง (Room)</label>
              <input
                type="text"
                value={locRoom}
                onChange={(e) => setLocRoom(e.target.value)}
                placeholder="เช่น 301"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700">ชื่อห้อง / สถานที่ *</label>
            <input
              type="text"
              value={locName}
              onChange={(e) => setLocName(e.target.value)}
              placeholder="เช่น ห้องปฏิบัติการคอมพิวเตอร์"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700">หน่วยงานที่ดูแล</label>
            <select
              value={locDeptId}
              onChange={(e) => setLocDeptId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              <option value="">-- ไม่ระบุ --</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.code} - {d.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
            <button
              type="button"
              onClick={() => setIsLocModalOpen(false)}
              className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={isSavingLoc}
              className="inline-flex items-center gap-1.5 rounded-lg bg-gov-700 px-4 py-2 text-xs font-semibold text-white"
            >
              {isSavingLoc && <Loader2 className="h-4 w-4 animate-spin" />}
              บันทึกสถานที่ตั้ง
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
