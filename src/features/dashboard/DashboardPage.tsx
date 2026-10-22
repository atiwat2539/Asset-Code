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

const PIE_COLORS = ['#10b981', '#0ea5e9', '#f59e0b', '#f97316', '#64748b', '#e11d48'];

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
      color: 'bg-gov-700 text-white shadow-gov-700/30',
      hoverCard:
        'hover:border-gov-400 hover:bg-gradient-to-br hover:from-white hover:via-gov-50/70 hover:to-sky-100/60 hover:shadow-xl hover:shadow-gov-600/15',
      topBar: 'from-gov-600 to-sky-500',
      valueHover: 'group-hover:text-gov-800',
    },
    {
      label: 'มูลค่าครุภัณฑ์รวม (ไม่รวมจำหน่าย)',
      value: formatCurrency(dashboardData.totalValue),
      sub: 'คำนวณตามราคาทุนที่ขึ้นทะเบียน',
      icon: Banknote,
      color: 'bg-emerald-600 text-white shadow-emerald-600/30',
      hoverCard:
        'hover:border-emerald-400 hover:bg-gradient-to-br hover:from-white hover:via-emerald-50/80 hover:to-teal-100/60 hover:shadow-xl hover:shadow-emerald-600/15',
      topBar: 'from-emerald-500 to-teal-400',
      valueHover: 'group-hover:text-emerald-700',
    },
    {
      label: 'ครุภัณฑ์พร้อมใช้งาน',
      value: `${formatNumber(dashboardData.availableCount)} รายการ`,
      sub: 'สามารถเบิก/ขอยืมปฏิบัติงานได้',
      icon: CheckCircle2,
      color: 'bg-teal-600 text-white shadow-teal-600/30',
      hoverCard:
        'hover:border-teal-400 hover:bg-gradient-to-br hover:from-white hover:via-teal-50/80 hover:to-cyan-100/60 hover:shadow-xl hover:shadow-teal-600/15',
      topBar: 'from-teal-500 to-cyan-400',
      valueHover: 'group-hover:text-teal-700',
    },
    {
      label: 'ครุภัณฑ์ที่กำลังถูกยืม',
      value: `${formatNumber(dashboardData.borrowedCount)} รายการ`,
      sub: 'อยู่ระหว่างการยืมใช้งานราชการ',
      icon: Repeat,
      color: 'bg-sky-600 text-white shadow-sky-600/30',
      hoverCard:
        'hover:border-sky-400 hover:bg-gradient-to-br hover:from-white hover:via-sky-50/80 hover:to-blue-100/60 hover:shadow-xl hover:shadow-sky-600/15',
      topBar: 'from-sky-500 to-blue-500',
      valueHover: 'group-hover:text-sky-700',
    },
    {
      label: 'อยู่ระหว่างซ่อมบำรุง',
      value: `${formatNumber(dashboardData.maintenanceCount)} รายการ`,
      sub: `ใบแจ้งซ่อมคงค้าง ${dashboardData.activeMaintenanceTickets} ใบ`,
      icon: Wrench,
      color: 'bg-amber-600 text-white shadow-amber-600/30',
      hoverCard:
        'hover:border-amber-400 hover:bg-gradient-to-br hover:from-white hover:via-amber-50/80 hover:to-orange-100/60 hover:shadow-xl hover:shadow-amber-600/15',
      topBar: 'from-amber-500 to-orange-400',
      valueHover: 'group-hover:text-amber-700',
    },
    {
      label: 'คำขอที่รออนุมัติรวม',
      value: `${formatNumber(dashboardData.pendingApprovals)} รายการ`,
      sub: 'ยืม-คืน / โอนย้าย / แทงจำหน่าย',
      icon: Clock,
      color: 'bg-rose-600 text-white shadow-rose-600/30',
      hoverCard:
        'hover:border-rose-400 hover:bg-gradient-to-br hover:from-white hover:via-rose-50/80 hover:to-pink-100/60 hover:shadow-xl hover:shadow-rose-600/15',
      topBar: 'from-rose-500 to-pink-500',
      valueHover: 'group-hover:text-rose-700',
    },
    {
      label: 'รอบตรวจนับที่กำลังดำเนินการ',
      value: `${formatNumber(dashboardData.activeInventorySessions.length)} รอบ`,
      sub:
        dashboardData.activeInventorySessions[0]?.session_code ||
        'ไม่มีรอบตรวจนับที่ค้างอยู่',
      icon: ClipboardCheck,
      color: 'bg-purple-600 text-white shadow-purple-600/30',
      hoverCard:
        'hover:border-purple-400 hover:bg-gradient-to-br hover:from-white hover:via-purple-50/80 hover:to-fuchsia-100/60 hover:shadow-xl hover:shadow-purple-600/15',
      topBar: 'from-purple-500 to-fuchsia-500',
      valueHover: 'group-hover:text-purple-700',
    },
    {
      label: 'กิจกรรมที่กำลังจะมาถึง',
      value: `${formatNumber(dashboardData.upcomingEvents.length)} กิจกรรม`,
      sub: 'ปฏิทินงานพัสดุและองค์กร',
      icon: CalendarDays,
      color: 'bg-indigo-600 text-white shadow-indigo-600/30',
      hoverCard:
        'hover:border-indigo-400 hover:bg-gradient-to-br hover:from-white hover:via-indigo-50/80 hover:to-violet-100/60 hover:shadow-xl hover:shadow-indigo-600/15',
      topBar: 'from-indigo-500 to-violet-500',
      valueHover: 'group-hover:text-indigo-700',
    },
  ];

  return (
    <div className="space-y-6">
      {/* แถบต้อนรับผู้ใช้งานและวันที่ปัจจุบัน */}
      <div className="relative overflow-hidden rounded-2xl border border-gov-200/80 bg-gradient-to-r from-gov-900 via-gov-800 to-indigo-900 p-5 sm:p-6 text-white shadow-lg transition-all duration-300 hover:shadow-xl">
        <div className="pointer-events-none absolute -right-10 -top-10 h-44 w-44 rounded-full bg-sky-400/15 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-12 left-1/3 h-40 w-40 rounded-full bg-amber-400/10 blur-2xl" />

        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-sky-200 backdrop-blur-xs border border-white/15">
              <Sparkles className="h-3.5 w-3.5 text-amber-300" />
              <span>{ROLE_LABELS[role]?.label || 'ผู้ใช้งานระบบ'}</span>
            </div>
            <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
              สวัสดี, {displayUserName}
            </h1>
            <p className="text-xs sm:text-sm text-sky-100/85">
              ยินดีต้อนรับสู่แดชบอร์ดบริหารจัดการครุภัณฑ์สำนักงาน — สรุปสถานะครุภัณฑ์และธุรกรรมพัสดุแบบเรียลไทม์
            </p>
          </div>

          <div className="flex flex-col items-start sm:items-end gap-2.5">
            <div className="inline-flex items-center gap-2 rounded-xl bg-white/12 px-4 py-2 text-xs sm:text-sm font-semibold text-white backdrop-blur-xs border border-white/20 shadow-xs">
              <CalendarDays className="h-4 w-4 text-amber-300 shrink-0" />
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
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs transition-all duration-300 hover:border-gov-300 hover:shadow-lg lg:col-span-2">
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
                    cursor={{ fill: 'rgba(14, 165, 233, 0.12)' }}
                    contentStyle={{
                      borderRadius: '12px',
                      border: '1px solid #bae6fd',
                      boxShadow: '0 10px 25px -5px rgba(14, 165, 233, 0.2)',
                    }}
                  />
                  <Bar dataKey="count" name="จำนวนครุภัณฑ์ (รายการ)" fill="#1e3a8a" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* กราฟสัดส่วนสถานะ */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs transition-all duration-300 hover:border-emerald-300 hover:shadow-lg">
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
                      border: '1px solid #a7f3d0',
                      boxShadow: '0 10px 25px -5px rgba(16, 185, 129, 0.2)',
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
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs transition-all duration-300 hover:border-sky-300 hover:shadow-lg">
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
                    cursor={{ fill: 'rgba(2, 132, 199, 0.12)' }}
                    contentStyle={{
                      borderRadius: '12px',
                      border: '1px solid #bae6fd',
                      boxShadow: '0 10px 25px -5px rgba(2, 132, 199, 0.2)',
                    }}
                  />
                  <Bar dataKey="count" name="จำนวน (รายการ)" fill="#0284c7" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* รายการยืม-คืนที่ต้องดำเนินการ */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs transition-all duration-300 hover:border-amber-300 hover:shadow-lg">
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
                  className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/70 p-3 text-xs transition-all duration-200 hover:translate-x-1 hover:border-sky-300 hover:bg-gradient-to-r hover:from-sky-50/90 hover:to-indigo-50/60 hover:shadow-xs"
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
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs transition-all duration-300 hover:border-indigo-300 hover:shadow-lg">
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
                  className="rounded-lg border border-slate-100 bg-slate-50/70 p-3 text-xs transition-all duration-200 hover:translate-x-1 hover:border-indigo-300 hover:bg-gradient-to-r hover:from-indigo-50/90 hover:to-purple-50/60 hover:shadow-xs"
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
      <div className="rounded-xl border border-slate-200 bg-white shadow-2xs overflow-hidden transition-all duration-300 hover:border-gov-300 hover:shadow-md">
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
                      className="transition-colors duration-200 hover:bg-gradient-to-r hover:from-gov-50/90 hover:via-sky-50/60 hover:to-transparent"
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
