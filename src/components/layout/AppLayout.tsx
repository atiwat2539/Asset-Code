import React, { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  LayoutDashboard,
  Package,
  QrCode,
  ClipboardCheck,
  ArrowLeftRight,
  Repeat,
  Wrench,
  FileX2,
  CalendarDays,
  FileBarChart2,
  History,
  Users,
  Settings,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Building2,
  Menu,
  X,
  UserCircle2,
} from 'lucide-react';
import { cn, ROLE_LABELS } from '@/lib/utils';
import { useAuth } from '@/features/auth/AuthContext';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { SetupGuideBanner } from './SetupGuideBanner';
import type { SystemSettings, UserRole } from '@/types/database';
import { toast } from 'sonner';

interface NavItem {
  label: string;
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  roles: UserRole[];
}

const NAV_ITEMS: NavItem[] = [
  {
    label: 'แดชบอร์ดภาพรวม',
    to: '/',
    icon: LayoutDashboard,
    roles: ['admin', 'asset_officer', 'requester'],
  },
  {
    label: 'ทะเบียนครุภัณฑ์',
    to: '/assets',
    icon: Package,
    roles: ['admin', 'asset_officer', 'requester'],
  },
  {
    label: 'สแกน / พิมพ์ QR & Barcode',
    to: '/qr-barcode',
    icon: QrCode,
    roles: ['admin', 'asset_officer', 'requester'],
  },
  {
    label: 'ตรวจนับครุภัณฑ์ประจำปี',
    to: '/inventory',
    icon: ClipboardCheck,
    roles: ['admin', 'asset_officer'],
  },
  {
    label: 'ระบบยืม-คืนครุภัณฑ์',
    to: '/borrowing',
    icon: Repeat,
    roles: ['admin', 'asset_officer', 'requester'],
  },
  {
    label: 'โอนย้ายสถานที่/ผู้รับผิดชอบ',
    to: '/transfers',
    icon: ArrowLeftRight,
    roles: ['admin', 'asset_officer', 'requester'],
  },
  {
    label: 'แจ้งซ่อมและบำรุงรักษา',
    to: '/maintenance',
    icon: Wrench,
    roles: ['admin', 'asset_officer', 'requester'],
  },
  {
    label: 'การจำหน่าย / แทงจำหน่าย',
    to: '/disposal',
    icon: FileX2,
    roles: ['admin', 'asset_officer'],
  },
  {
    label: 'ปฏิทินกิจกรรมองค์กร',
    to: '/calendar',
    icon: CalendarDays,
    roles: ['admin', 'asset_officer', 'requester'],
  },
  {
    label: 'รายงานและส่งออก',
    to: '/reports',
    icon: FileBarChart2,
    roles: ['admin', 'asset_officer'],
  },
  {
    label: 'ประวัติการใช้งาน (Audit Log)',
    to: '/audit-logs',
    icon: History,
    roles: ['admin', 'asset_officer'],
  },
  {
    label: 'จัดการผู้ใช้และหน่วยงาน',
    to: '/users',
    icon: Users,
    roles: ['admin'],
  },
  {
    label: 'ตั้งค่าระบบ',
    to: '/settings',
    icon: Settings,
    roles: ['admin'],
  },
];

export function AppLayout() {
  const { profile, user, role, signOut } = useAuth();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const { data: settings } = useQuery({
    queryKey: ['system-settings'],
    queryFn: async () => {
      if (!isSupabaseConfigured()) return null;
      const { data } = await supabase.from('system_settings').select('*').limit(1).maybeSingle();
      return data as SystemSettings | null;
    },
    staleTime: 1000 * 60 * 5,
  });

  const orgName = settings?.org_name || 'สำนักงานบริหารงานพัสดุและครุภัณฑ์กลาง';
  const orgShort = settings?.org_short_name || 'สบพ.';

  const visibleNavItems = NAV_ITEMS.filter((item) => item.roles.includes(role));

  const handleSignOut = async () => {
    await signOut();
    toast.success('ออกจากระบบเรียบร้อยแล้ว');
    navigate('/login');
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-100">
      <SetupGuideBanner />

      <div className="flex flex-1">
        {/* Mobile Overlay */}
        {mobileOpen && (
          <div
            className="fixed inset-0 z-40 bg-slate-900/60 lg:hidden"
            onClick={() => setMobileOpen(false)}
          />
        )}

        {/* Sidebar */}
        <aside
          className={cn(
            'fixed inset-y-0 left-0 z-50 flex flex-col bg-gov-900 text-slate-100 transition-all duration-200 lg:static',
            collapsed ? 'w-20' : 'w-68',
            mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
          )}
        >
          {/* Brand Header */}
          <div className="flex h-16 items-center justify-between border-b border-white/10 px-4 bg-gov-800/80">
            <div className="flex items-center gap-3 overflow-hidden">
              <img
                src={settings?.logo_url || '/cmu-library-logo.png'}
                alt="โลโก้หน่วยงาน"
                className="h-9 w-auto max-w-[110px] shrink-0 rounded-lg object-contain bg-white px-1.5 py-1 shadow-xs"
              />
              {!collapsed && (
                <div className="truncate">
                  <p className="truncate text-sm font-bold text-white leading-tight">{orgShort}</p>
                  <p className="truncate text-[11px] text-sky-200/80">ระบบบริหารครุภัณฑ์</p>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => setCollapsed((c) => !c)}
              className="hidden rounded-lg p-1.5 text-slate-300 hover:bg-white/10 hover:text-white lg:inline-flex"
              aria-label={collapsed ? 'ขยายแถบเมนู' : 'ย่อแถบเมนู'}
            >
              {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            </button>

            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="rounded-lg p-1.5 text-slate-300 hover:bg-white/10 lg:hidden"
              aria-label="ปิดเมนู"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Navigation Links */}
          <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
            {visibleNavItems.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  onClick={() => setMobileOpen(false)}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-gov-600 text-white shadow-xs'
                        : 'text-slate-300 hover:bg-white/10 hover:text-white',
                      collapsed && 'justify-center px-2'
                    )
                  }
                  title={collapsed ? item.label : undefined}
                >
                  <Icon className="h-5 w-5 shrink-0" />
                  {!collapsed && <span className="truncate">{item.label}</span>}
                </NavLink>
              );
            })}
          </nav>

          {/* Footer Role Info */}
          <div className="border-t border-white/10 p-3 text-xs text-slate-400">
            {!collapsed ? (
              <div className="rounded-lg bg-white/5 p-2.5">
                <p className="font-medium text-slate-200 truncate">
                  {profile?.full_name || user?.email || 'ผู้ใช้งานระบบ'}
                </p>
                <p className="mt-0.5 text-[11px] text-sky-300">
                  {ROLE_LABELS[role]?.label || role}
                </p>
              </div>
            ) : (
              <div className="flex justify-center" title={ROLE_LABELS[role]?.label}>
                <UserCircle2 className="h-6 w-6 text-sky-300" />
              </div>
            )}
          </div>
        </aside>

        {/* Main Content Wrapper */}
        <div className="flex flex-1 flex-col min-w-0">
          {/* Top Header */}
          <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-slate-200 bg-white px-4 sm:px-6 shadow-2xs">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={() => setMobileOpen(true)}
                className="rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-100 lg:hidden"
                aria-label="เปิดเมนูนำทาง"
              >
                <Menu className="h-5 w-5" />
              </button>
              <div className="min-w-0">
                <h2 className="truncate text-sm font-bold text-gov-800 sm:text-base">{orgName}</h2>
                <p className="hidden text-xs text-slate-500 sm:block">
                  สำนักหอสมุด มหาวิทยาลัยเชียงใหม่
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="hidden text-right sm:block">
                <p className="text-xs font-semibold text-slate-800">
                  {profile?.full_name || user?.email || 'โหมดตรวจสอบระบบ'}
                </p>
                <span
                  className={cn(
                    'inline-block rounded-full border px-2 py-0.5 text-[10px] font-medium',
                    ROLE_LABELS[role]?.badgeClass
                  )}
                >
                  {ROLE_LABELS[role]?.label}
                </span>
              </div>

              {user ? (
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200 transition-colors"
                >
                  <LogOut className="h-4 w-4" />
                  <span className="hidden sm:inline">ออกจากระบบ</span>
                </button>
              ) : (
                <NavLink
                  to="/login"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-gov-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-gov-800"
                >
                  เข้าสู่ระบบ
                </NavLink>
              )}
            </div>
          </header>

          {/* Page Content */}
          <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1600px] w-full mx-auto">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
