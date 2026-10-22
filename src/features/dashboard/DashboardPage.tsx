import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';
import {
  Package,
  Banknote,
  CheckCircle2,
  Repeat,
  Wrench,
  Clock,
  ClipboardCheck,
  CalendarDays,
  RefreshCw,
  ArrowRight,
  Radio,
  Sparkles,
} from 'lucide-react';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import {
  ASSET_STATUS_META,
  BORROW_STATUS_META,
  formatCurrency,
  formatNumber,
  ROLE_LABELS,
  translateSupabaseError,
} from '@/lib/utils';
import { formatThaiDate, formatThaiDateTime } from '@/lib/date';
import { useAuth } from '@/features/auth/AuthContext';
import { EmptyState, ErrorState, LoadingState, PageHeader, StatusBadge } from '@/components/ui/common';
import type { Asset, BorrowRequest, CorporateEvent } from '@/types/database';

// ชุดสี PANTONE (Greenery, Serenity, Peach Fuzz, Living Coral, Mocha Mousse, Very Peri)
const PIE_COLORS = ['#5B9E7D', '#6F9FD8', '#E89968', '#E06D79', '#A47864', '#6667AB'];

function formatFullThaiCurrentDate(date: Date): string {
  try {
    return new Intl.DateTimeFormat('th-TH-u-ca-buddhist', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(date);
  } catch {
    return formatThaiDate(date.toISOString());
  }
}

export function DashboardPage() {
  const { user, profile, role } = useAuth();
  const queryClient = useQueryClient();
  const configured = isSupabaseConfigured();
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  const [nowDate, setNowDate] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNowDate(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  const displayUserName =
    profile?.full_name ||
    (user?.user_metadata?.full_name as string | undefined) ||
    user?.email ||
    'ผู้ใช้งานระบบ';
  const currentThaiDateText = formatFullThaiCurrentDate(nowDate);

  const {
    data: dashboardData,
    isLoading,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ['dashboard-summary'],
    queryFn: async () => {
      if (!configured) {
        return null;
      }

      const [
        assetsRes,
        borrowPendingRes,
        transfersPendingRes,
        maintenancePendingRes,
        disposalPendingRes,
        inventoryActiveRes,
        eventsRes,
        recentBorrowsRes,
      ] = await Promise.all([
        supabase
          .from('assets')
          .select('*, category:asset_categories(id, name, code), department:departments(id, name, code)')
          .eq('is_archived', false)
          .order('created_at', { ascending: false }),
        supabase.from('borrow_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('asset_transfers').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase
          .from('maintenance_requests')
          .select('id', { count: 'exact', head: true })
          .in('status', ['pending', 'in_progress', 'waiting_parts']),
        supabase
          .from('disposal_requests')
          .select('id', { count: 'exact', head: true })
          .in('status', ['submitted', 'under_review']),
        supabase
          .from('inventory_sessions')
          .select('id, session_code, name, fiscal_year, end_date')
          .eq('status', 'in_progress'),
        supabase
          .from('corporate_events')
          .select('*')
          .gte('end_at', new Date().toISOString())
          .order('start_at', { ascending: true })
          .limit(5),
        supabase
          .from('borrow_requests')
          .select('*, asset:assets(id, asset_code, name), requester:profiles!borrow_requests_requester_id_fkey(full_name)')
          .in('status', ['pending', 'borrowed', 'overdue'])
          .order('created_at', { ascending: false })
          .limit(5),
      ]);

      if (assetsRes.error) throw assetsRes.error;

      const assets = (assetsRes.data || []) as Asset[];
      const totalAssets = assets.length;
      const totalValue = assets
        .filter((a) => a.status !== 'disposed')
        .reduce((sum, a) => sum + Number(a.unit_price || 0), 0);

      const availableCount = assets.filter((a) => a.status === 'available').length;
      const borrowedCount = assets.filter((a) => a.status === 'borrowed').length;
      const maintenanceCount = assets.filter((a) => a.status === 'under_maintenance').length;

      const pendingApprovals =
        (borrowPendingRes.count || 0) +
        (transfersPendingRes.count || 0) +
        (disposalPendingRes.count || 0);

      // จัดกลุ่มตามหมวดหมู่
      const byCategoryMap = new Map<string, { name: string; count: number; value: number }>();
      assets.forEach((a) => {
        const catName = a.category?.name || 'ไม่ระบุหมวดหมู่';
        const prev = byCategoryMap.get(catName) || { name: catName, count: 0, value: 0 };
        prev.count += 1;
        prev.value += Number(a.unit_price || 0);
        byCategoryMap.set(catName, prev);
      });

      // จัดกลุ่มตามสถานะ
      const byStatusMap = new Map<string, { name: string; value: number }>();
      assets.forEach((a) => {
        const label = ASSET_STATUS_META[a.status]?.label || a.status;
        const prev = byStatusMap.get(label) || { name: label, value: 0 };
        prev.value += 1;
        byStatusMap.set(label, prev);
      });

      // จัดกลุ่มตามหน่วยงาน
      const byDeptMap = new Map<string, { name: string; count: number }>();
      assets.forEach((a) => {
        const deptName = a.department?.name || 'ไม่ระบุหน่วยงาน';
        const prev = byDeptMap.get(deptName) || { name: deptName, count: 0 };
        prev.count += 1;
        byDeptMap.set(deptName, prev);
      });

      return {
        totalAssets,
        totalValue,
        availableCount,
        borrowedCount,
        maintenanceCount,
        pendingApprovals,
        activeInventorySessions: inventoryActiveRes.data || [],
        activeMaintenanceTickets: maintenancePendingRes.count || 0,
        categoryChart: Array.from(byCategoryMap.values()),
        statusChart: Array.from(byStatusMap.values()),
        deptChart: Array.from(byDeptMap.values()),
        latestAssets: assets.slice(0, 6),
        upcomingEvents: (eventsRes.data || []) as CorporateEvent[],
        actionableBorrows: (recentBorrowsRes.data || []) as BorrowRequest[],
      };
    },
  });

  // Supabase Realtime Subscription พร้อม Cleanup เมื่อออกจากหน้า
  useEffect(() => {
    if (!configured) return;

    const channel = supabase
      .channel('dashboard-realtime-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'assets' }, () => {
        queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'borrow_requests' }, () => {
        queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'maintenance_requests' }, () => {
        queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
      })
      .subscribe((status) => {
        setRealtimeConnected(status === 'SUBSCRIBED');
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [configured, queryClient]);

  if (!configured) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="แดชบอร์ดบริหารจัดการครุภัณฑ์สำนักงาน"
          subtitle="สรุปข้อมูลครุภัณฑ์ คำขอรออนุมัติ รอบตรวจนับ และกำหนดการสำคัญแบบเรียลไทม์"
        />
        <EmptyState
          title="ยังไม่ได้เชื่อมต่อฐานข้อมูล Supabase"
          description="กรุณาตั้งค่า VITE_SUPABASE_URL และ VITE_SUPABASE_ANON_KEY ในไฟล์ .env.local และรัน SQL Migration เพื่อแสดงข้อมูลจริงจากฐานข้อมูลหน่วยงาน"
        />
      </div>
    );
  }

  if (isLoading) {
    return <LoadingState message="กำลังประมวลผลข้อมูลสถิติครุภัณฑ์จาก Supabase..." />;
  }

  if (error || !dashboardData) {
    return (
      <ErrorState
        message={translateSupabaseError(error)}
        onRetry={() => refetch()}
      />
    );
  }

  const statCards = [
    {
      label: 'จำนวนครุภัณฑ์ทั้งหมด',
      value: `${formatNumber(dashboardData.totalAssets)} รายการ`,
      sub: `พร้อมใช้งาน ${formatNumber(dashboardData.availableCount)} รายการ`,
      icon: Package,
      // PANTONE 17-3938 Very Peri
      color: 'bg-[#6667AB] text-white shadow-[#6667AB]/30',
      hoverCard:
        'hover:border-[#9E91D3] hover:bg-gradient-to-br hover:from-white hover:via-[#F6F5FB] hover:to-[#EDEAF7] hover:shadow-xl hover:shadow-[#6667AB]/20',
      topBar: 'from-[#5F4B8B] via-[#6667AB] to-[#92A8D1]',
      valueHover: 'group-hover:text-[#5F4B8B]',
    },
    {
      label: 'มูลค่าครุภัณฑ์รวม (ไม่รวมจำหน่าย)',
      value: formatCurrency(dashboardData.totalValue),
      sub: 'คำนวณตามราคาทุนที่ขึ้นทะเบียน',
      icon: Banknote,
      // PANTONE Greenery / Sage
      color: 'bg-[#5B9E7D] text-white shadow-[#5B9E7D]/30',
      hoverCard:
        'hover:border-[#88B04B]/60 hover:bg-gradient-to-br hover:from-white hover:via-[#F2F8F5] hover:to-[#E1EFE8] hover:shadow-xl hover:shadow-[#5B9E7D]/20',
      topBar: 'from-[#5B9E7D] to-[#88B04B]',
      valueHover: 'group-hover:text-[#3E7A5D]',
    },
    {
      label: 'ครุภัณฑ์พร้อมใช้งาน',
      value: `${formatNumber(dashboardData.availableCount)} รายการ`,
      sub: 'สามารถเบิก/ขอยืมปฏิบัติงานได้',
      icon: CheckCircle2,
      // PANTONE Biscay Green / Teal Sage
      color: 'bg-[#4C9A8A] text-white shadow-[#4C9A8A]/30',
      hoverCard:
        'hover:border-[#7BB8AC] hover:bg-gradient-to-br hover:from-white hover:via-[#F0F8F6] hover:to-[#DFF0EC] hover:shadow-xl hover:shadow-[#4C9A8A]/20',
      topBar: 'from-[#4C9A8A] to-[#7BB8AC]',
      valueHover: 'group-hover:text-[#377B6D]',
    },
    {
      label: 'ครุภัณฑ์ที่กำลังถูกยืม',
      value: `${formatNumber(dashboardData.borrowedCount)} รายการ`,
      sub: 'อยู่ระหว่างการยืมใช้งานราชการ',
      icon: Repeat,
      // PANTONE 15-3919 Serenity
      color: 'bg-[#6F9FD8] text-white shadow-[#6F9FD8]/30',
      hoverCard:
        'hover:border-[#92A8D1] hover:bg-gradient-to-br hover:from-white hover:via-[#F3F7FC] hover:to-[#E4ECF7] hover:shadow-xl hover:shadow-[#6F9FD8]/20',
      topBar: 'from-[#6F9FD8] to-[#92A8D1]',
      valueHover: 'group-hover:text-[#4372AA]',
    },
    {
      label: 'อยู่ระหว่างซ่อมบำรุง',
      value: `${formatNumber(dashboardData.maintenanceCount)} รายการ`,
      sub: `ใบแจ้งซ่อมคงค้าง ${dashboardData.activeMaintenanceTickets} ใบ`,
      icon: Wrench,
      // PANTONE 13-1023 Peach Fuzz / Warm Apricot
      color: 'bg-[#E2875A] text-white shadow-[#E2875A]/30',
      hoverCard:
        'hover:border-[#FFBE98] hover:bg-gradient-to-br hover:from-white hover:via-[#FDF6F2] hover:to-[#FBE9DF] hover:shadow-xl hover:shadow-[#E2875A]/20',
      topBar: 'from-[#E2875A] to-[#FFBE98]',
      valueHover: 'group-hover:text-[#B85E32]',
    },
    {
      label: 'คำขอที่รออนุมัติรวม',
      value: `${formatNumber(dashboardData.pendingApprovals)} รายการ`,
      sub: 'ยืม-คืน / โอนย้าย / แทงจำหน่าย',
      icon: Clock,
      // PANTONE 16-1546 Living Coral / Rose Quartz
      color: 'bg-[#E06D79] text-white shadow-[#E06D79]/30',
      hoverCard:
        'hover:border-[#F7CAC9] hover:bg-gradient-to-br hover:from-white hover:via-[#FDF4F5] hover:to-[#F9E5E6] hover:shadow-xl hover:shadow-[#E06D79]/20',
      topBar: 'from-[#E06D79] to-[#F7CAC9]',
      valueHover: 'group-hover:text-[#B84754]',
    },
    {
      label: 'รอบตรวจนับที่กำลังดำเนินการ',
      value: `${formatNumber(dashboardData.activeInventorySessions.length)} รอบ`,
      sub:
        dashboardData.activeInventorySessions[0]?.session_code ||
        'ไม่มีรอบตรวจนับที่ค้างอยู่',
      icon: ClipboardCheck,
      // PANTONE 18-3838 Ultra Violet
      color: 'bg-[#5F4B8B] text-white shadow-[#5F4B8B]/30',
      hoverCard:
        'hover:border-[#C1B7E4] hover:bg-gradient-to-br hover:from-white hover:via-[#F6F5FB] hover:to-[#E9E4F5] hover:shadow-xl hover:shadow-[#5F4B8B]/20',
      topBar: 'from-[#5F4B8B] to-[#9E91D3]',
      valueHover: 'group-hover:text-[#49386E]',
    },
    {
      label: 'กิจกรรมที่กำลังจะมาถึง',
      value: `${formatNumber(dashboardData.upcomingEvents.length)} กิจกรรม`,
      sub: 'ปฏิทินงานพัสดุและองค์กร',
      icon: CalendarDays,
      // PANTONE 17-1230 Mocha Mousse
      color: 'bg-[#A47864] text-white shadow-[#A47864]/30',
      hoverCard:
        'hover:border-[#C9A99A] hover:bg-gradient-to-br hover:from-white hover:via-[#FAF6F4] hover:to-[#F1E7E2] hover:shadow-xl hover:shadow-[#A47864]/20',
      topBar: 'from-[#A47864] to-[#D2B4A6]',
      valueHover: 'group-hover:text-[#7D5644]',
    },
  ];

  return (
    <div className="space-y-6">
      {/* แถบต้อนรับผู้ใช้งานและวันที่ปัจจุบัน (โทน PANTONE Ultra Violet & Very Peri) */}
      <div className="relative overflow-hidden rounded-2xl border border-gov-200/80 bg-gradient-to-r from-[#2E2348] via-[#5F4B8B] to-[#6667AB] p-5 sm:p-6 text-white shadow-lg transition-all duration-300 hover:shadow-xl hover:shadow-[#5F4B8B]/20">
        <div className="pointer-events-none absolute -right-10 -top-10 h-44 w-44 rounded-full bg-[#FFBE98]/20 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-12 left-1/3 h-40 w-40 rounded-full bg-[#92A8D1]/20 blur-2xl" />

        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/12 px-3 py-1 text-xs font-medium text-[#FFBE98] backdrop-blur-xs border border-white/15">
              <Sparkles className="h-3.5 w-3.5 text-[#FFBE98]" />
              <span>{ROLE_LABELS[role]?.label || 'ผู้ใช้งานระบบ'}</span>
            </div>
            <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
              สวัสดี, {displayUserName}
            </h1>
            <p className="text-xs sm:text-sm text-[#EDEAF7]/90">
              ยินดีต้อนรับสู่แดชบอร์ดบริหารจัดการครุภัณฑ์สำนักงาน — สรุปสถานะครุภัณฑ์และธุรกรรมพัสดุแบบเรียลไทม์
            </p>
          </div>

          <div className="flex flex-col items-start sm:items-end gap-2.5">
            <div className="inline-flex items-center gap-2 rounded-xl bg-white/12 px-4 py-2 text-xs sm:text-sm font-semibold text-white backdrop-blur-xs border border-white/20 shadow-xs">
              <CalendarDays className="h-4 w-4 text-[#FFBE98] shrink-0" />
              <span>วันที่ปัจจุบัน: {currentThaiDateText}</span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${
                  realtimeConnected
                    ? 'border-emerald-400/40 bg-emerald-500/20 text-emerald-200'
                    : 'border-white/20 bg-white/10 text-slate-200'
                }`}
                title={
                  realtimeConnected
                    ? 'เชื่อมต่อ Supabase Realtime แล้ว'
                    : 'ใช้โหมดดึงข้อมูลมาตรฐาน (Refetch)'
                }
              >
                <Radio className={`h-3.5 w-3.5 ${realtimeConnected ? 'text-emerald-300 animate-pulse' : 'text-slate-300'}`} />
                {realtimeConnected ? 'Realtime Connected' : 'Standard Sync'}
              </span>
              <button
                type="button"
                onClick={() => refetch()}
                disabled={isFetching}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/25 bg-white/10 px-3 py-1 text-xs font-semibold text-white transition hover:bg-white/20 disabled:opacity-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
                รีเฟรชข้อมูล
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* KPI Cards พร้อม Hover Color Effect */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {statCards.map((card) => {
          const Icon = card.icon;
          return (
            <div
              key={card.label}
              className={`group relative overflow-hidden rounded-xl border border-slate-200 bg-white p-5 shadow-2xs transition-all duration-300 hover:-translate-y-1.5 hover:scale-[1.02] cursor-pointer ${card.hoverCard}`}
            >
              {/* แถบสีด้านบนที่จะขยายเต็มเมื่อ Hover */}
              <div
                className={`absolute inset-x-0 top-0 h-1 w-0 bg-gradient-to-r ${card.topBar} transition-all duration-300 group-hover:w-full`}
              />
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold text-slate-500 transition-colors group-hover:text-slate-700">
                    {card.label}
                  </p>
                  <p
                    className={`mt-1.5 text-lg font-bold text-slate-900 sm:text-xl transition-colors ${card.valueHover}`}
                  >
                    {card.value}
                  </p>
                  <p className="mt-1 text-xs text-slate-500 transition-colors group-hover:text-slate-600">
                    {card.sub}
                  </p>
                </div>
                <div
                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl shadow-md transition-all duration-300 group-hover:scale-110 group-hover:rotate-3 ${card.color}`}
                >
                  <Icon className="h-5 w-5" />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* กราฟแยกตามหมวดหมู่ */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs transition-all duration-300 hover:border-[#9E91D3] hover:shadow-lg hover:shadow-[#6667AB]/10 lg:col-span-2">
          <h2 className="text-base font-bold text-slate-900">จำนวนครุภัณฑ์แยกตามประเภท/หมวดหมู่</h2>
          <p className="text-xs text-slate-500">เปรียบเทียบจำนวนรายการครุภัณฑ์ในแต่ละหมวดหมู่มาตรฐาน</p>
          <div className="mt-4 h-72 w-full">
            {dashboardData.categoryChart.length === 0 ? (
              <div className="flex h-full items-center justify-center text-xs text-slate-400">
                ยังไม่มีข้อมูลครุภัณฑ์สำหรับสร้างกราฟ
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dashboardData.categoryChart} margin={{ top: 10, right: 20, left: 0, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip
                    cursor={{ fill: 'rgba(102, 103, 171, 0.12)' }}
                    contentStyle={{
                      borderRadius: '12px',
                      border: '1px solid #DCD6F0',
                      boxShadow: '0 10px 25px -5px rgba(95, 75, 139, 0.2)',
                    }}
                  />
                  <Bar dataKey="count" name="จำนวนครุภัณฑ์ (รายการ)" fill="#6667AB" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* กราฟสัดส่วนสถานะ */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs transition-all duration-300 hover:border-[#5B9E7D]/60 hover:shadow-lg hover:shadow-[#5B9E7D]/10">
          <h2 className="text-base font-bold text-slate-900">สัดส่วนตามสถานะครุภัณฑ์</h2>
          <p className="text-xs text-slate-500">ภาพรวมสถานะความพร้อมใช้งานปัจจุบัน</p>
          <div className="mt-4 h-72 w-full">
            {dashboardData.statusChart.length === 0 ? (
              <div className="flex h-full items-center justify-center text-xs text-slate-400">
                ยังไม่มีข้อมูลสถานะครุภัณฑ์
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={dashboardData.statusChart}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="45%"
                    outerRadius={80}
                    label
                  >
                    {dashboardData.statusChart.map((_entry, index) => (
                      <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      borderRadius: '12px',
                      border: '1px solid #DCD6F0',
                      boxShadow: '0 10px 25px -5px rgba(95, 75, 139, 0.18)',
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: '12px' }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* กราฟแยกตามหน่วยงาน และกำหนดการที่กำลังจะมาถึง */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs transition-all duration-300 hover:border-[#92A8D1] hover:shadow-lg hover:shadow-[#6F9FD8]/15">
          <h2 className="text-base font-bold text-slate-900">ครุภัณฑ์แยกตามหน่วยงาน/ฝ่าย</h2>
          <p className="text-xs text-slate-500">จำนวนครุภัณฑ์ในความรับผิดชอบของแต่ละกอง/สำนัก</p>
          <div className="mt-4 h-64 w-full">
            {dashboardData.deptChart.length === 0 ? (
              <div className="flex h-full items-center justify-center text-xs text-slate-400">
                ยังไม่มีข้อมูลหน่วยงาน
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  layout="vertical"
                  data={dashboardData.deptChart}
                  margin={{ top: 5, right: 20, left: 20, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                  <YAxis dataKey="name" type="category" width={120} tick={{ fontSize: 11 }} />
                  <Tooltip
                    cursor={{ fill: 'rgba(95, 75, 139, 0.12)' }}
                    contentStyle={{
                      borderRadius: '12px',
                      border: '1px solid #DCD6F0',
                      boxShadow: '0 10px 25px -5px rgba(95, 75, 139, 0.2)',
                    }}
                  />
                  <Bar dataKey="count" name="จำนวน (รายการ)" fill="#5F4B8B" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* รายการยืม-คืนที่ต้องดำเนินการ */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs transition-all duration-300 hover:border-[#FFBE98] hover:shadow-lg hover:shadow-[#E2875A]/15">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900">รายการยืม-คืนที่ต้องติดตาม</h2>
              <p className="text-xs text-slate-500">คำขอยืมรออนุมัติและรายการที่อยู่ระหว่างยืม</p>
            </div>
            <Link to="/borrowing" className="text-xs font-semibold text-gov-700 hover:underline flex items-center gap-1">
              ดูทั้งหมด <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          <div className="mt-4 space-y-2.5">
            {dashboardData.actionableBorrows.length === 0 ? (
              <p className="py-8 text-center text-xs text-slate-400">ไม่มีรายการค้างดำเนินการ</p>
            ) : (
              dashboardData.actionableBorrows.map((req) => (
                <div
                  key={req.id}
                  className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/70 p-3 text-xs transition-all duration-200 hover:translate-x-1 hover:border-[#92A8D1] hover:bg-gradient-to-r hover:from-[#F3F7FC] hover:to-[#F6F5FB] hover:shadow-xs"
                >
                  <div className="min-w-0 pr-2">
                    <p className="font-semibold text-slate-900 truncate">
                      {req.request_no} &bull; {req.asset?.name || '-'}
                    </p>
                    <p className="mt-0.5 text-slate-500">
                      ผู้ขอ: {req.requester?.full_name || '-'} | กำหนดคืน: {formatThaiDate(req.expected_return_date)}
                    </p>
                  </div>
                  <StatusBadge
                    label={BORROW_STATUS_META[req.status]?.label || req.status}
                    className={BORROW_STATUS_META[req.status]?.badgeClass}
                  />
                </div>
              ))
            )}
          </div>
        </div>

        {/* กิจกรรมที่กำลังจะมาถึง */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs transition-all duration-300 hover:border-[#C1B7E4] hover:shadow-lg hover:shadow-[#5F4B8B]/15">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900">กำหนดการและกิจกรรมล่าสุด</h2>
              <p className="text-xs text-slate-500">ตารางตรวจนับ ซ่อมบำรุง และประชุม</p>
            </div>
            <Link to="/calendar" className="text-xs font-semibold text-gov-700 hover:underline flex items-center gap-1">
              ปฏิทิน <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          <div className="mt-4 space-y-2.5">
            {dashboardData.upcomingEvents.length === 0 ? (
              <p className="py-8 text-center text-xs text-slate-400">ไม่มีกิจกรรมที่กำลังจะมาถึง</p>
            ) : (
              dashboardData.upcomingEvents.map((ev) => (
                <div
                  key={ev.id}
                  className="rounded-lg border border-slate-100 bg-slate-50/70 p-3 text-xs transition-all duration-200 hover:translate-x-1 hover:border-[#C1B7E4] hover:bg-gradient-to-r hover:from-[#F6F5FB] hover:to-[#FDF6F2] hover:shadow-xs"
                >
                  <p className="font-semibold text-slate-900">{ev.title}</p>
                  <p className="mt-0.5 text-slate-600">{formatThaiDateTime(ev.start_at)}</p>
                  {ev.location && <p className="mt-0.5 text-slate-500">สถานที่: {ev.location}</p>}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* ตารางครุภัณฑ์ที่ขึ้นทะเบียนล่าสุด */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-2xs overflow-hidden transition-all duration-300 hover:border-[#C1B7E4] hover:shadow-md">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <h2 className="text-base font-bold text-slate-900">รายการครุภัณฑ์ที่ขึ้นทะเบียนล่าสุด</h2>
            <p className="text-xs text-slate-500">แสดงรายการครุภัณฑ์ที่เพิ่มหรือปรับปรุงล่าสุดในระบบ</p>
          </div>
          <Link
            to="/assets"
            className="inline-flex items-center gap-1.5 rounded-lg bg-gov-50 px-3 py-1.5 text-xs font-semibold text-gov-700 hover:bg-gov-100"
          >
            เปิดทะเบียนครุภัณฑ์ทั้งหมด <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs font-semibold uppercase text-slate-600 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3">เลขครุภัณฑ์</th>
                <th className="px-4 py-3">ชื่อรายการครุภัณฑ์</th>
                <th className="px-4 py-3">ประเภท</th>
                <th className="px-4 py-3">หน่วยงาน</th>
                <th className="px-4 py-3 text-right">ราคาต่อหน่วย</th>
                <th className="px-4 py-3">วันที่รับเข้า</th>
                <th className="px-4 py-3">สถานะ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-xs sm:text-sm">
              {dashboardData.latestAssets.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                    ยังไม่มีรายการครุภัณฑ์ในฐานข้อมูล
                  </td>
                </tr>
              ) : (
                dashboardData.latestAssets.map((asset) => {
                  const statusMeta = ASSET_STATUS_META[asset.status];
                  return (
                    <tr
                      key={asset.id}
                      className="transition-colors duration-200 hover:bg-gradient-to-r hover:from-[#F6F5FB] hover:via-[#EDEAF7]/60 hover:to-[#FDF6F2]/50"
                    >
                      <td className="px-4 py-3 font-mono font-semibold text-gov-700">
                        <Link to={`/assets/${asset.id}`} className="hover:underline">
                          {asset.asset_code}
                        </Link>
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-900">{asset.name}</td>
                      <td className="px-4 py-3 text-slate-600">{asset.category?.name || '-'}</td>
                      <td className="px-4 py-3 text-slate-600">{asset.department?.name || '-'}</td>
                      <td className="px-4 py-3 text-right font-medium text-slate-800">
                        {formatCurrency(asset.unit_price)}
                      </td>
                      <td className="px-4 py-3 text-slate-600">{formatThaiDate(asset.acquired_date)}</td>
                      <td className="px-4 py-3">
                        <StatusBadge
                          label={statusMeta?.label || asset.status}
                          className={statusMeta?.badgeClass}
                          dotClass={statusMeta?.dotClass}
                        />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
