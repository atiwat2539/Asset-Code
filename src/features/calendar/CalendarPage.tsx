import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import {
  Plus,
  ChevronLeft,
  ChevronRight,
  Edit3,
  Trash2,
  Loader2,
  MapPin,
  Users,
} from 'lucide-react';
import { assertSupabaseConfigured, isSupabaseConfigured, recordAuditLog, supabase } from '@/lib/supabase';
import { EVENT_CATEGORY_META, translateSupabaseError } from '@/lib/utils';
import { formatThaiDate, formatThaiDateTime, toBuddhistYear } from '@/lib/date';
import { useAuth } from '@/features/auth/AuthContext';
import {
  ConfirmDialog,
  EmptyState,
  LoadingState,
  Modal,
  PageHeader,
  StatusBadge,
} from '@/components/ui/common';
import type { BorrowRequest, CorporateEvent, EventCategory } from '@/types/database';

const eventSchema = z.object({
  title: z.string().min(2, 'กรุณาระบุชื่อกิจกรรม'),
  description: z.string().optional(),
  category: z.enum(['meeting', 'inventory', 'maintenance', 'training', 'due_date', 'general']),
  start_at: z.string().min(1, 'กรุณาระบุวันเวลาเริ่มต้น'),
  end_at: z.string().min(1, 'กรุณาระบุวันเวลาสิ้นสุด'),
  location: z.string().optional(),
  participants: z.string().optional(),
  notes: z.string().optional(),
});

type EventFormValues = z.infer<typeof eventSchema>;

const THAI_MONTH_NAMES = [
  'มกราคม',
  'กุมภาพันธ์',
  'มีนาคม',
  'เมษายน',
  'พฤษภาคม',
  'มิถุนายน',
  'กรกฎาคม',
  'สิงหาคม',
  'กันยายน',
  'ตุลาคม',
  'พฤศจิกายน',
  'ธันวาคม',
];

export function CalendarPage() {
  const { user, hasRole } = useAuth();
  const canManage = hasRole(['admin', 'asset_officer']);
  const queryClient = useQueryClient();
  const configured = isSupabaseConfigured();

  const [viewMode, setViewMode] = useState<'month' | 'week' | 'list'>('month');
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [currentMonth, setCurrentMonth] = useState(() => new Date());

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CorporateEvent | null>(null);
  const [deletingEvent, setDeletingEvent] = useState<CorporateEvent | null>(null);

  const { data: eventsData, isLoading } = useQuery({
    queryKey: ['corporate-events-all'],
    queryFn: async () => {
      if (!configured) return { events: [] as CorporateEvent[], borrowsDue: [] as BorrowRequest[] };
      const [evRes, brRes] = await Promise.all([
        supabase
          .from('corporate_events')
          .select('*, organizer:profiles!corporate_events_organizer_id_fkey(*)')
          .order('start_at', { ascending: true }),
        supabase
          .from('borrow_requests')
          .select('*, asset:assets(asset_code, name), requester:profiles!borrow_requests_requester_id_fkey(full_name)')
          .in('status', ['borrowed', 'overdue']),
      ]);
      if (evRes.error) throw evRes.error;
      return {
        events: (evRes.data || []) as CorporateEvent[],
        borrowsDue: (brRes.data || []) as BorrowRequest[],
      };
    },
  });

  // ผสานกิจกรรมในตาราง corporate_events เข้ากับวันครบกำหนดคืนครุภัณฑ์โดยไม่สร้างแถวซ้ำในฐานข้อมูล
  const combinedEvents = useMemo(() => {
    const baseEvents = eventsData?.events || [];
    const dueEvents: (CorporateEvent & { isVirtual?: boolean })[] = (
      eventsData?.borrowsDue || []
    ).map((br) => ({
      id: `borrow-due-${br.id}`,
      title: `ครบกำหนดคืน: ${br.asset?.asset_code || ''} (${br.requester?.full_name || ''})`,
      description: `ใบยืมเลขที่ ${br.request_no} - ${br.asset?.name || ''}`,
      category: 'due_date' as EventCategory,
      start_at: `${br.expected_return_date}T09:00:00+07:00`,
      end_at: `${br.expected_return_date}T16:30:00+07:00`,
      all_day: true,
      location: 'คลังพัสดุกลาง',
      organizer_id: null,
      participants: br.requester?.full_name || null,
      related_entity_type: 'borrow_requests',
      related_entity_id: br.id,
      notes: br.purpose,
      created_at: br.created_at,
      updated_at: br.updated_at,
      isVirtual: true,
    }));

    return [...baseEvents, ...dueEvents].filter((ev) =>
      categoryFilter ? ev.category === categoryFilter : true
    );
  }, [eventsData, categoryFilter]);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<EventFormValues>({
    resolver: zodResolver(eventSchema),
    defaultValues: {
      title: '',
      description: '',
      category: 'meeting',
      start_at: new Date().toISOString().slice(0, 16),
      end_at: new Date(Date.now() + 2 * 3600 * 1000).toISOString().slice(0, 16),
      location: '',
      participants: '',
      notes: '',
    },
  });

  const openCreateModal = () => {
    setEditingEvent(null);
    const now = new Date();
    const startStr = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
    const endStr = new Date(now.getTime() + 2 * 3600000 - now.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);

    reset({
      title: '',
      description: '',
      category: 'meeting',
      start_at: startStr,
      end_at: endStr,
      location: '',
      participants: '',
      notes: '',
    });
    setIsModalOpen(true);
  };

  const openEditModal = (ev: CorporateEvent) => {
    setEditingEvent(ev);
    reset({
      title: ev.title,
      description: ev.description || '',
      category: ev.category,
      start_at: new Date(ev.start_at).toISOString().slice(0, 16),
      end_at: new Date(ev.end_at).toISOString().slice(0, 16),
      location: ev.location || '',
      participants: ev.participants || '',
      notes: ev.notes || '',
    });
    setIsModalOpen(true);
  };

  const onSubmitEvent = async (values: EventFormValues) => {
    try {
      assertSupabaseConfigured();
      if (new Date(values.end_at) < new Date(values.start_at)) {
        toast.error('วันเวลาสิ้นสุดต้องไม่น้อยกว่าวันเวลาเริ่มต้น');
        return;
      }

      const payload = {
        title: values.title.trim(),
        description: values.description?.trim() || null,
        category: values.category,
        start_at: new Date(values.start_at).toISOString(),
        end_at: new Date(values.end_at).toISOString(),
        location: values.location?.trim() || null,
        participants: values.participants?.trim() || null,
        notes: values.notes?.trim() || null,
        organizer_id: editingEvent ? editingEvent.organizer_id : user?.id || null,
      };

      if (editingEvent) {
        const { error } = await supabase
          .from('corporate_events')
          .update(payload)
          .eq('id', editingEvent.id);
        if (error) throw error;

        await recordAuditLog({
          action: 'EVENT_UPDATED',
          entityType: 'corporate_events',
          entityId: editingEvent.id,
          summary: `แก้ไขกิจกรรมปฏิทิน: ${values.title}`,
        });
        toast.success('บันทึกการแก้ไขกิจกรรมสำเร็จ');
      } else {
        const { data, error } = await supabase
          .from('corporate_events')
          .insert(payload)
          .select('id')
          .single();
        if (error) throw error;

        await recordAuditLog({
          action: 'EVENT_CREATED',
          entityType: 'corporate_events',
          entityId: data.id,
          summary: `สร้างกิจกรรมปฏิทินใหม่: ${values.title}`,
        });
        toast.success('เพิ่มกิจกรรมในปฏิทินองค์กรสำเร็จ');
      }

      setIsModalOpen(false);
      queryClient.invalidateQueries({ queryKey: ['corporate-events-all'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
    } catch (err) {
      toast.error(translateSupabaseError(err));
    }
  };

  const handleConfirmDelete = async () => {
    if (!deletingEvent) return;
    try {
      assertSupabaseConfigured();
      const { error } = await supabase
        .from('corporate_events')
        .delete()
        .eq('id', deletingEvent.id);
      if (error) throw error;

      await recordAuditLog({
        action: 'EVENT_DELETED',
        entityType: 'corporate_events',
        entityId: deletingEvent.id,
        summary: `ลบกิจกรรมปฏิทิน: ${deletingEvent.title}`,
      });

      toast.success('ลบกิจกรรมเรียบร้อยแล้ว');
      setDeletingEvent(null);
      queryClient.invalidateQueries({ queryKey: ['corporate-events-all'] });
    } catch (err) {
      toast.error(translateSupabaseError(err));
    }
  };

  // สร้างตารางวันในเดือนปัจจุบัน
  const calendarDays = useMemo(() => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startWeekday = firstDay.getDay(); // 0 = อาทิตย์

    const days: { date: Date; inMonth: boolean }[] = [];
    for (let i = startWeekday - 1; i >= 0; i--) {
      days.push({ date: new Date(year, month, -i), inMonth: false });
    }
    for (let d = 1; d <= lastDay.getDate(); d++) {
      days.push({ date: new Date(year, month, d), inMonth: true });
    }
    while (days.length % 7 !== 0) {
      const nextIdx = days.length - (startWeekday + lastDay.getDate()) + 1;
      days.push({ date: new Date(year, month + 1, nextIdx), inMonth: false });
    }
    return days;
  }, [currentMonth]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="ปฏิทินกิจกรรมองค์กรและงานพัสดุ (Corporate Calendar)"
        subtitle="แสดงตารางการตรวจนับประจำปี แผนซ่อมบำรุง ประชุมคณะกรรมการ และวันครบกำหนดคืนครุภัณฑ์"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setViewMode('month')}
                className={`rounded-md px-3 py-1.5 font-semibold ${
                  viewMode === 'month' ? 'bg-gov-700 text-white' : 'text-slate-600'
                }`}
              >
                รายเดือน
              </button>
              <button
                type="button"
                onClick={() => setViewMode('week')}
                className={`rounded-md px-3 py-1.5 font-semibold ${
                  viewMode === 'week' ? 'bg-gov-700 text-white' : 'text-slate-600'
                }`}
              >
                รายสัปดาห์
              </button>
              <button
                type="button"
                onClick={() => setViewMode('list')}
                className={`rounded-md px-3 py-1.5 font-semibold ${
                  viewMode === 'list' ? 'bg-gov-700 text-white' : 'text-slate-600'
                }`}
              >
                รายการทั้งหมด
              </button>
            </div>

            {canManage && (
              <button
                type="button"
                onClick={openCreateModal}
                className="inline-flex items-center gap-1.5 rounded-lg bg-gov-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-gov-800"
              >
                <Plus className="h-4 w-4" />
                เพิ่มกิจกรรมใหม่
              </button>
            )}
          </div>
        }
      />

      {/* แถบเลือกเดือนและหมวดหมู่ */}
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-2xs sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() =>
              setCurrentMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))
            }
            className="rounded-lg border border-slate-300 p-1.5 hover:bg-slate-50"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <h2 className="text-base font-bold text-slate-900 min-w-44 text-center">
            {THAI_MONTH_NAMES[currentMonth.getMonth()]} พ.ศ.{' '}
            {toBuddhistYear(currentMonth.getFullYear())}
          </h2>
          <button
            type="button"
            onClick={() =>
              setCurrentMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))
            }
            className="rounded-lg border border-slate-300 p-1.5 hover:bg-slate-50"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-slate-600">กรองหมวดหมู่:</span>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs"
          >
            <option value="">ทุกหมวดหมู่กิจกรรม</option>
            {Object.entries(EVENT_CATEGORY_META).map(([key, meta]) => (
              <option key={key} value={key}>
                {meta.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {isLoading ? (
        <LoadingState message="กำลังโหลดปฏิทินกิจกรรมองค์กร..." />
      ) : viewMode === 'month' ? (
        <div className="rounded-xl border border-slate-200 bg-white shadow-2xs overflow-hidden">
          <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50 text-center text-xs font-semibold text-slate-600">
            {['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'].map((d) => (
              <div key={d} className="py-2.5">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 divide-x divide-y divide-slate-200">
            {calendarDays.map(({ date, inMonth }, idx) => {
              const isoDay = date.toISOString().slice(0, 10);
              const dayEvents = combinedEvents.filter(
                (ev) => ev.start_at.slice(0, 10) <= isoDay && ev.end_at.slice(0, 10) >= isoDay
              );
              return (
                <div
                  key={idx}
                  className={`min-h-28 p-2 text-xs ${
                    inMonth ? 'bg-white' : 'bg-slate-50/60 text-slate-400'
                  }`}
                >
                  <div className="font-semibold text-right">{date.getDate()}</div>
                  <div className="mt-1 space-y-1">
                    {dayEvents.slice(0, 3).map((ev) => (
                      <div
                        key={ev.id}
                        onClick={() => {
                          if (!(ev as { isVirtual?: boolean }).isVirtual && canManage) {
                            openEditModal(ev);
                          }
                        }}
                        className={`truncate rounded px-1.5 py-0.5 text-[11px] font-medium cursor-pointer border ${
                          EVENT_CATEGORY_META[ev.category]?.badgeClass || ''
                        }`}
                        title={ev.title}
                      >
                        {ev.title}
                      </div>
                    ))}
                    {dayEvents.length > 3 && (
                      <div className="text-[10px] text-slate-500">+{dayEvents.length - 3} รายการ</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {combinedEvents.length === 0 ? (
            <EmptyState
              title="ไม่พบกิจกรรมในหมวดหมู่นี้"
              description="สามารถเพิ่มกิจกรรมใหม่ได้จากปุ่มด้านบน"
            />
          ) : (
            combinedEvents.map((ev) => {
              const isVirtual = Boolean((ev as { isVirtual?: boolean }).isVirtual);
              return (
                <div
                  key={ev.id}
                  className="flex flex-col justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-2xs sm:flex-row sm:items-center"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <StatusBadge
                        label={EVENT_CATEGORY_META[ev.category]?.label || ev.category}
                        className={EVENT_CATEGORY_META[ev.category]?.badgeClass}
                      />
                      <span className="text-xs font-medium text-slate-500">
                        {formatThaiDateTime(ev.start_at)} — {formatThaiDate(ev.end_at)}
                      </span>
                    </div>
                    <h3 className="text-sm font-bold text-slate-900">{ev.title}</h3>
                    {ev.description && <p className="text-xs text-slate-600">{ev.description}</p>}
                    <div className="flex flex-wrap gap-4 pt-1 text-xs text-slate-500">
                      {ev.location && (
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="h-3.5 w-3.5" /> {ev.location}
                        </span>
                      )}
                      {ev.participants && (
                        <span className="inline-flex items-center gap-1">
                          <Users className="h-3.5 w-3.5" /> {ev.participants}
                        </span>
                      )}
                    </div>
                  </div>

                  {!isVirtual && canManage && (
                    <div className="flex items-center gap-1.5 self-end sm:self-center">
                      <button
                        type="button"
                        onClick={() => openEditModal(ev)}
                        className="rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-100"
                        title="แก้ไขกิจกรรม"
                      >
                        <Edit3 className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeletingEvent(ev)}
                        className="rounded-lg border border-rose-200 p-2 text-rose-600 hover:bg-rose-50"
                        title="ลบกิจกรรม"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Modal เพิ่ม/แก้ไขกิจกรรม */}
      <Modal
        open={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingEvent ? 'แก้ไขกิจกรรมปฏิทินองค์กร' : 'สร้างกิจกรรมใหม่ในปฏิทิน'}
      >
        <form onSubmit={handleSubmit(onSubmitEvent)} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700">
              ชื่อกิจกรรม <span className="text-rose-600">*</span>
            </label>
            <input
              type="text"
              {...register('title')}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
            {errors.title && <p className="mt-1 text-xs text-rose-600">{errors.title.message}</p>}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-slate-700">หมวดหมู่กิจกรรม</label>
              <select
                {...register('category')}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                {Object.entries(EVENT_CATEGORY_META).map(([key, meta]) => (
                  <option key={key} value={key}>
                    {meta.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">สถานที่จัดกิจกรรม</label>
              <input
                type="text"
                placeholder="เช่น ห้องประชุมใหญ่ ชั้น 1"
                {...register('location')}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">วันและเวลาเริ่มต้น</label>
              <input
                type="datetime-local"
                {...register('start_at')}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">วันและเวลาสิ้นสุด</label>
              <input
                type="datetime-local"
                {...register('end_at')}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700">รายละเอียดกิจกรรม</label>
            <textarea
              rows={2}
              {...register('description')}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700">ผู้เข้าร่วม / กลุ่มเป้าหมาย</label>
            <input
              type="text"
              placeholder="เช่น คณะกรรมการตรวจนับพัสดุทุกสำนัก"
              {...register('participants')}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>

          <div className="flex items-center justify-between gap-2 pt-3 border-t border-slate-200">
            <div>
              {editingEvent && canManage && (
                <button
                  type="button"
                  onClick={() => {
                    setIsModalOpen(false);
                    setDeletingEvent(editingEvent);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-100"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  ลบกิจกรรมนี้
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
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
                บันทึกกิจกรรม
              </button>
            </div>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(deletingEvent)}
        onClose={() => setDeletingEvent(null)}
        onConfirm={handleConfirmDelete}
        title="ยืนยันการลบกิจกรรม"
        description={`คุณต้องการลบกิจกรรม "${deletingEvent?.title || ''}" ออกจากปฏิทินองค์กรใช่หรือไม่?`}
        confirmLabel="ยืนยันลบ"
      />
    </div>
  );
}
