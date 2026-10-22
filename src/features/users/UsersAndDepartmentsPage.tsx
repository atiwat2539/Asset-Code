import React, { useState } from 'react';
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
} from 'lucide-react';
import {
  assertSupabaseConfigured,
  createIsolatedAuthClient,
  recordAuditLog,
  supabase,
} from '@/lib/supabase';
import { ROLE_LABELS, translateSupabaseError } from '@/lib/utils';
import { useDepartments, useLocations, useProfiles } from '@/hooks/useMasterData';
import { LoadingState, Modal, PageHeader, StatusBadge } from '@/components/ui/common';
import type { Profile, UserRole } from '@/types/database';

export function UsersAndDepartmentsPage() {
  const queryClient = useQueryClient();
  const { data: profiles = [], isLoading: loadingProfiles } = useProfiles();
  const { data: departments = [], isLoading: loadingDepts } = useDepartments();
  const { data: locations = [], isLoading: loadingLocs } = useLocations();

  const [activeTab, setActiveTab] = useState<'users' | 'departments' | 'locations'>('users');

  // Edit User Role State
  const [editingProfile, setEditingProfile] = useState<Profile | null>(null);
  const [selectedRole, setSelectedRole] = useState<UserRole>('requester');
  const [selectedDeptId, setSelectedDeptId] = useState('');
  const [positionText, setPositionText] = useState('');
  const [isActiveUser, setIsActiveUser] = useState(true);
  const [isSavingUser, setIsSavingUser] = useState(false);

  // Create User State (Admin สร้างบัญชีให้บุคลากรโดยตรง)
  const [isCreateUserModalOpen, setIsCreateUserModalOpen] = useState(false);
  const [newUserFullName, setNewUserFullName] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
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

  const openEditUser = (p: Profile) => {
    setEditingProfile(p);
    setSelectedRole(p.role);
    setSelectedDeptId(p.department_id || '');
    setPositionText(p.position || '');
    setIsActiveUser(p.is_active);
  };

  const handleSaveUserRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProfile) return;

    setIsSavingUser(true);
    try {
      assertSupabaseConfigured();
      // เรียกใช้ RPC admin_update_user_role ที่บังคับตรวจสิทธิ์ Admin ฝั่ง Database และบันทึก Audit Log
      const { error } = await supabase.rpc('admin_update_user_role', {
        p_target_user_id: editingProfile.id,
        p_new_role: selectedRole,
        p_department_id: selectedDeptId || null,
        p_position: positionText.trim() || null,
        p_is_active: isActiveUser,
      });

      if (error) throw error;

      toast.success(`อัปเดตบทบาทและข้อมูลของ ${editingProfile.full_name} สำเร็จ`);
      setEditingProfile(null);
      queryClient.invalidateQueries({ queryKey: ['profiles'] });
      queryClient.invalidateQueries({ queryKey: ['audit-logs-list'] });
    } catch (err) {
      toast.error(translateSupabaseError(err));
    } finally {
      setIsSavingUser(false);
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
        // อัปเดตชื่อและกำหนดสิทธิ์/หน่วยงานผ่าน RPC ของ Admin
        await supabase
          .from('profiles')
          .update({ full_name: cleanName })
          .eq('id', data.user.id);

        await supabase.rpc('admin_update_user_role', {
          p_target_user_id: data.user.id,
          p_new_role: newUserRole,
          p_department_id: newUserDeptId || null,
          p_position: cleanPosition,
          p_is_active: true,
        });

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
        subtitle="กำหนดสิทธิ์ผู้ใช้งานผ่านกระบวนการที่ปลอดภัยฝั่งฐานข้อมูล พร้อมจัดการโครงสร้างหน่วยงานและอาคารสถานที่"
      />

      {/* คำแนะนำการเชิญผู้ใช้ใหม่ตามหลักความปลอดภัยของ Supabase Auth */}
      <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-xs text-sky-950 flex items-start gap-3">
        <Info className="mt-0.5 h-5 w-5 shrink-0 text-sky-700" />
        <div>
          <p className="font-bold">แนวปฏิบัติการเพิ่มบุคลากรเข้าสู่ระบบอย่างปลอดภัย:</p>
          <p className="mt-0.5 text-sky-900">
            เพื่อความปลอดภัยสูงสุด ระบบไม่อนุญาตให้ผู้ใช้สมัครเป็น Admin ด้วยตนเองและไม่เก็บ Service Role Key ไว้ใน Front-end การเพิ่มบุคลากรใหม่สามารถทำได้ผ่าน <strong>Supabase Dashboard &gt; Authentication &gt; Users &gt; Invite User</strong> เมื่อผู้ใช้เข้าสู่ระบบครั้งแรก ระบบจะสร้างโปรไฟล์เป็น <code className="rounded bg-sky-200/70 px-1 py-0.5 font-mono">requester</code> โดยอัตโนมัติ จากนั้น Admin สามารถปรับระดับสิทธิ์เป็น <code className="rounded bg-sky-200/70 px-1 py-0.5 font-mono">asset_officer</code> หรือ <code className="rounded bg-sky-200/70 px-1 py-0.5 font-mono">admin</code> ได้ที่ตารางด้านล่าง
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
          loadingProfiles ? (
            <LoadingState message="กำลังโหลดรายชื่อผู้ใช้งาน..." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs font-semibold text-slate-600 border-b border-slate-200">
                  <tr>
                    <th className="p-3.5">ชื่อ-นามสกุล</th>
                    <th className="p-3.5">อีเมล</th>
                    <th className="p-3.5">ตำแหน่ง</th>
                    <th className="p-3.5">หน่วยงานสังกัด</th>
                    <th className="p-3.5">บทบาทสิทธิ์ (Role)</th>
                    <th className="p-3.5">สถานะบัญชี</th>
                    <th className="p-3.5 text-right">จัดการสิทธิ์</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-xs">
                  {profiles.map((p) => (
                    <tr key={p.id} className="hover:bg-slate-50">
                      <td className="p-3.5 font-semibold text-slate-900">{p.full_name}</td>
                      <td className="p-3.5 font-mono text-slate-600">{p.email}</td>
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
                        <button
                          type="button"
                          onClick={() => openEditUser(p)}
                          className="inline-flex items-center gap-1 rounded-lg bg-gov-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-gov-800"
                        >
                          <Edit3 className="h-3.5 w-3.5" />
                          กำหนดบทบาท
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
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
              <label className="block text-xs font-semibold text-slate-700">ตำแหน่งราชการ</label>
              <input
                type="text"
                value={newUserPosition}
                onChange={(e) => setNewUserPosition(e.target.value)}
                placeholder="เช่น นักวิชาการพัสดุปฏิบัติการ"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-slate-700">ระดับสิทธิ์ (Role)</label>
              <select
                value={newUserRole}
                onChange={(e) => setNewUserRole(e.target.value as UserRole)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold"
              >
                {Object.entries(ROLE_LABELS).map(([key, meta]) => (
                  <option key={key} value={key}>
                    {meta.label}
                  </option>
                ))}
              </select>
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

      {/* Modal กำหนดบทบาทผู้ใช้ */}
      <Modal
        open={Boolean(editingProfile)}
        onClose={() => setEditingProfile(null)}
        title={`กำหนดสิทธิ์ผู้ใช้งาน: ${editingProfile?.full_name || ''}`}
        description="การเปลี่ยนแปลงระดับสิทธิ์จะถูกบังคับใช้ใน RLS ทันที และบันทึกประวัติลงใน Audit Log"
      >
        {editingProfile && (
          <form onSubmit={handleSaveUserRole} className="space-y-4">
            <div className="rounded-lg bg-slate-50 p-3 text-xs border border-slate-200">
              <p>อีเมลผู้ใช้งาน: <strong className="font-mono">{editingProfile.email}</strong></p>
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

            <div className="flex items-center gap-2">
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
                บันทึกการเปลี่ยนสิทธิ์
              </button>
            </div>
          </form>
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
