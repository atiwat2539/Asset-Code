import React, { useEffect, useState } from 'react';
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
  Menu,
  X,
  UserCircle2,
} from 'lucide-react';
import { cn, ROLE_LABELS } from '@/lib/utils';
import { formatThaiDate, formatThaiDateNumeric, formatThaiDateTime } from '@/lib/date';
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

interface NavSection {
  title: string;
  items: NavItem[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    title: 'ภาพรวมและทะเบียน',
    items: [
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
    ],
  },
  {
    title: 'บริการและธุรกรรม',
    items: [
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
    ],
  },
  {
    title: 'ตรวจนับและจำหน่าย',
    items: [
      {
        label: 'ตรวจนับครุภัณฑ์ประจำปี',
        to: '/inventory',
        icon: ClipboardCheck,
        roles: ['admin', 'asset_officer'],
      },
      {
        label: 'การจำหน่าย / แทงจำหน่าย',
        to: '/disposal',
        icon: FileX2,
        roles: ['admin', 'asset_officer'],
      },
    ],
  },
  {
    title: 'รายงานและกิจกรรม',
    items: [
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
    ],
  },
  {
    title: 'การจัดการระบบ',
    items: [
      {
        label: 'จัดการผู้ใช้และหน่วยงาน',
        to: '/users',
        icon: Users,
        roles: ['admin'],
      },
      {
        label: 'ประวัติการใช้งาน (Audit Log)',
        to: '/audit-logs',
        icon: History,
        roles: ['admin', 'asset_officer'],
      },
      {
        label: 'ตั้งค่าระบบ',
        to: '/settings',
        icon: Settings,
        roles: ['admin'],
      },
    ],
  },
];

export function AppLayout() {
  const { profile, user, role, signOut } = useAuth();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // แปลงการแสดงผลของ <input type="date"> และ <input type="datetime-local"> ทุกจุดในระบบให้แสดงเป็นปี พ.ศ. อัตโนมัติ
  useEffect(() => {
    const syncAllDateInputs = () => {
      const inputs = document.querySelectorAll<HTMLInputElement>(
        'input[type="date"], input[type="datetime-local"]'
      );
      inputs.forEach((input) => {
        // ป้องกันกรณีผู้ใช้ลบวันที่บางส่วน (เช่น ลบเฉพาะวัน/เดือน) แล้ว Browser ค้างสถานะ badInput ทำให้ส่งฟอร์มไม่ผ่านทั้งที่ช่องดูเหมือนว่าง
        if (!input.value && input.validity?.badInput && document.activeElement !== input) {
          input.value = '';
        }

        const val = input.value;
        if (!val) {
          const placeholder =
            input.type === 'datetime-local'
              ? 'วว/ดด/ปปปป ชม.:นาที (พ.ศ.)'
              : 'วว/ดด/ปปปป (พ.ศ.)';
          if (input.getAttribute('data-thai-date') !== placeholder) {
            input.setAttribute('data-thai-date', placeholder);
          }
          if (input.getAttribute('data-thai-empty') !== 'true') {
            input.setAttribute('data-thai-empty', 'true');
          }
        } else {
          const formatted =
            input.type === 'datetime-local'
              ? `${formatThaiDateTime(val)} (พ.ศ.)`
              : `${formatThaiDateNumeric(val)} (${formatThaiDate(val)})`;
          if (input.getAttribute('data-thai-date') !== formatted) {
            input.setAttribute('data-thai-date', formatted);
          }
          if (input.getAttribute('data-thai-empty') !== 'false') {
            input.setAttribute('data-thai-empty', 'false');
          }
        }
      });
    };

    const handleDateKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLInputElement | null;
      if (
        target &&
        target.tagName === 'INPUT' &&
        (target.type === 'date' || target.type === 'datetime-local') &&
        (e.key === 'Backspace' || e.key === 'Delete')
      ) {
        e.preventDefault();
        target.value = '';
        target.dispatchEvent(new Event('input', { bubbles: true }));
        target.dispatchEvent(new Event('change', { bubbles: true }));
        syncAllDateInputs();
      }
    };

    syncAllDateInputs();
    const timer = window.setInterval(syncAllDateInputs, 250);
    document.addEventListener('input', syncAllDateInputs, true);
    document.addEventListener('change', syncAllDateInputs, true);
    document.addEventListener('keydown', handleDateKeyDown, true);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('input', syncAllDateInputs, true);
      document.removeEventListener('change', syncAllDateInputs, true);
      document.removeEventListener('keydown', handleDateKeyDown, true);
    };
  }, []);

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

  const visibleSections = NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => item.roles.includes(role)),
  })).filter((section) => section.items.length > 0);

  const handleSignOut = async () => {
    await signOut();
    toast.success('ออกจากระบบเรียบร้อยแล้ว');
    navigate('/login');
  };

  return (
    <div className="min-h-screen flex flex-col bg-pantone-cloud">
      {/* แถบสี PANTONE Signature ด้านบนสุด */}
      <div className="h-1 w-full bg-gradient-to-r from-gov-700 via-pantone-peri to-pantone-peach" />
      <SetupGuideBanner />

      <div className="flex flex-1">
        {/* Mobile Overlay */}
        {mobileOpen && (
          <div
            className="fixed inset-0 z-40 bg-gov-900/60 backdrop-blur-xs lg:hidden"
            onClick={() => setMobileOpen(false)}
          />
        )}

        {/* Sidebar (PANTONE Ultra Violet / Nightshade Tone) */}
        <aside
          className={cn(
            'fixed inset-y-0 left-0 z-50 flex flex-col bg-gradient-to-b from-gov-900 via-gov-800 to-gov-900 text-slate-100 shadow-xl transition-all duration-200 lg:static',
            collapsed ? 'w-20' : 'w-68',
            mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
          )}
        >
          {/* Brand Header */}
          <div className="flex h-16 items-center justify-between border-b border-white/10 px-4 bg-white/5 backdrop-blur-xs">
            <div className="flex items-center gap-3 overflow-hidden">
              <img
                src={settings?.logo_url || '/cmu-library-logo.png'}
                alt="โลโก้หน่วยงาน"
                className="h-9 w-auto max-w-[110px] shrink-0 rounded-lg object-contain bg-white px-1.5 py-1 shadow-xs"
              />
              {!collapsed && (
                <div className="truncate">
                  <p className="truncate text-sm font-bold text-white leading-tight">{orgShort}</p>
                  <p className="truncate text-[11px] text-gov-200/90">สำนักหอสมุด มช.</p>
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
          <nav className="flex-1 space-y-3.5 overflow-y-auto px-3 py-4">
            {visibleSections.map((section, sectionIdx) => (
              <div key={section.title} className="space-y-1">
                {!collapsed ? (
                  <div className="flex items-center gap-2 px-3 pt-2 pb-1 text-[11px] font-bold uppercase tracking-wider text-gov-200/70">
                    <span className="h-1.5 w-1.5 rounded-full bg-pantone-peri/80" />
                    <span>{section.title}</span>
                  </div>
                ) : (
                  sectionIdx > 0 && <div className="my-2 border-t border-white/10" />
                )}
                {section.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.to === '/'}
                      onClick={() => setMobileOpen(false)}
                      className={({ isActive }) =>
                        cn(
                          'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                          isActive
                            ? 'bg-gov-600 text-white shadow-xs font-semibold'
                            : 'text-slate-300 hover:bg-white/10 hover:text-white',
                          collapsed && 'justify-center px-2'
                        )
                      }
                      title={collapsed ? item.label : undefined}
                    >
                      <Icon className="h-4.5 w-4.5 shrink-0" />
                      {!collapsed && <span className="truncate">{item.label}</span>}
                    </NavLink>
                  );
                })}
              </div>
            ))}
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
