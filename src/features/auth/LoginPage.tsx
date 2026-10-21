import React, { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import {
  Building2,
  Database,
  Eye,
  EyeOff,
  Lock,
  Loader2,
  Mail,
  ShieldAlert,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import { isSupabaseConfigured, recordAuditLog, supabase } from '@/lib/supabase';
import { translateSupabaseError } from '@/lib/utils';
import { useAuth } from './AuthContext';
import { SetupGuideModal } from '@/components/layout/SetupGuideBanner';

const loginSchema = z.object({
  email: z.string().min(1, 'กรุณากรอกอีเมลราชการหรืออีเมลผู้ใช้งาน').email('รูปแบบอีเมลไม่ถูกต้อง'),
  password: z.string().min(6, 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร'),
});

type LoginFormValues = z.infer<typeof loginSchema>;

export function LoginPage() {
  const { session, isLoading: authLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [showPassword, setShowPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [openSetupModal, setOpenSetupModal] = useState(false);

  const configured = isSupabaseConfigured();
  const fromPath = (location.state as { from?: { pathname?: string } })?.from?.pathname || '/';

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  });

  if (!authLoading && session) {
    return <Navigate to={fromPath} replace />;
  }

  const onSubmit = async (values: LoginFormValues) => {
    setErrorMessage(null);

    if (!configured) {
      const msg =
        'ยังไม่ได้ตั้งค่าการเชื่อมต่อ Supabase (.env.local) กรุณาตั้งค่า VITE_SUPABASE_URL และ VITE_SUPABASE_ANON_KEY ก่อนเข้าสู่ระบบ';
      setErrorMessage(msg);
      toast.error(msg);
      return;
    }

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: values.email.trim(),
        password: values.password,
      });

      if (error) {
        const friendly = translateSupabaseError(error);
        setErrorMessage(friendly);
        toast.error(friendly);
        return;
      }

      if (data.user) {
        await recordAuditLog({
          action: 'AUTH_LOGIN',
          entityType: 'auth',
          entityId: data.user.id,
          summary: `ผู้ใช้งาน ${data.user.email} เข้าสู่ระบบสำเร็จ`,
        });
        toast.success('เข้าสู่ระบบสำเร็จ');
        navigate(fromPath, { replace: true });
      }
    } catch (err) {
      const friendly = translateSupabaseError(err);
      setErrorMessage(friendly);
      toast.error(friendly);
    }
  };

  return (
    <div className="min-h-screen flex flex-col justify-between bg-gradient-to-br from-gov-900 via-gov-800 to-slate-900 text-slate-900">
      {/* แถบแจ้งสถานะด้านบน */}
      <div className="w-full border-b border-white/10 bg-slate-950/40 px-4 py-2.5 text-xs text-slate-200">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-sky-400" />
            <span>ระบบสารสนเทศเพื่อการบริหารจัดการครุภัณฑ์สำนักงาน หน่วยงานราชการไทย</span>
          </div>
          <div className="flex items-center gap-3">
            {configured ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-emerald-300 border border-emerald-400/30">
                <CheckCircle2 className="h-3.5 w-3.5" /> เชื่อมต่อ Supabase พร้อมใช้งาน
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setOpenSetupModal(true)}
                className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/20 px-3 py-1 text-amber-200 border border-amber-400/40 hover:bg-amber-500/30"
              >
                <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                ยังไม่ได้ตั้งค่า Supabase — คลิกดูวิธีตั้งค่า
              </button>
            )}
          </div>
        </div>
      </div>

      {/* กล่องเข้าสู่ระบบ */}
      <div className="flex flex-1 items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl border border-slate-200">
          <div className="bg-gov-800 px-6 py-7 text-center text-white">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/25">
              <Building2 className="h-8 w-8 text-sky-200" />
            </div>
            <h1 className="mt-4 text-xl font-bold tracking-tight">
              ระบบบริหารจัดการครุภัณฑ์สำนักงาน
            </h1>
            <p className="mt-1 text-xs text-sky-100/80">
              Government Enterprise Asset Management System
            </p>
          </div>

          <div className="p-6 sm:p-8">
            {!configured && (
              <div className="mb-5 rounded-xl border border-amber-300 bg-amber-50 p-3.5 text-xs text-amber-900">
                <div className="flex items-start gap-2.5">
                  <Database className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                  <div>
                    <p className="font-semibold">ยังไม่ได้เชื่อมต่อฐานข้อมูล Supabase</p>
                    <p className="mt-0.5 text-amber-800">
                      ระบบนี้ไม่ใช้ข้อมูลจำลองในการบันทึกหลอก กรุณาตั้งค่าไฟล์{' '}
                      <code className="rounded bg-amber-200/70 px-1 py-0.5 font-mono">.env.local</code>{' '}
                      ก่อนเข้าสู่ระบบ
                    </p>
                    <button
                      type="button"
                      onClick={() => setOpenSetupModal(true)}
                      className="mt-2 inline-flex items-center gap-1 font-semibold text-amber-900 underline"
                    >
                      เปิดคู่มือการตั้งค่า Supabase ทีละขั้นตอน &rarr;
                    </button>
                  </div>
                </div>
              </div>
            )}

            {errorMessage && (
              <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-xs text-rose-800">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
                <span>{errorMessage}</span>
              </div>
            )}

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
              <div>
                <label htmlFor="email" className="block text-xs font-semibold text-slate-700">
                  อีเมลผู้ใช้งาน (Email)
                </label>
                <div className="relative mt-1.5">
                  <Mail className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                  <input
                    id="email"
                    type="email"
                    autoComplete="email"
                    placeholder="name@agency.go.th"
                    {...register('email')}
                    className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-gov-600 focus:outline-none focus:ring-2 focus:ring-gov-600/20"
                  />
                </div>
                {errors.email && (
                  <p className="mt-1 text-xs text-rose-600">{errors.email.message}</p>
                )}
              </div>

              <div>
                <label htmlFor="password" className="block text-xs font-semibold text-slate-700">
                  รหัสผ่าน (Password)
                </label>
                <div className="relative mt-1.5">
                  <Lock className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    placeholder="••••••••"
                    {...register('password')}
                    className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-10 text-sm text-slate-900 placeholder:text-slate-400 focus:border-gov-600 focus:outline-none focus:ring-2 focus:ring-gov-600/20"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="absolute right-2.5 top-2 rounded p-0.5 text-slate-400 hover:text-slate-600"
                    aria-label={showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {errors.password && (
                  <p className="mt-1 text-xs text-rose-600">{errors.password.message}</p>
                )}
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-gov-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-gov-800 disabled:opacity-60"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    กำลังตรวจสอบสิทธิ์...
                  </>
                ) : (
                  'เข้าสู่ระบบ'
                )}
              </button>
            </form>

            <div className="mt-6 border-t border-slate-100 pt-4 text-center text-xs text-slate-500 space-y-1">
              <p>การกำหนดสิทธิ์ผู้ใช้งานควบคุมโดยผู้ดูแลระบบ (Admin) และบังคับใช้ผ่าน Supabase RLS</p>
              <p className="text-[11px] text-slate-400">
                หากยังไม่มีบัญชีผู้ใช้งาน กรุณาติดต่อผู้ดูแลระบบพัสดุของหน่วยงาน
              </p>
            </div>
          </div>
        </div>
      </div>

      <footer className="py-4 text-center text-xs text-slate-400">
        ระบบบริหารจัดการครุภัณฑ์สำนักงานหน่วยงานราชการ &bull; รองรับมาตรฐานความปลอดภัยข้อมูลและ Row Level Security
      </footer>

      <SetupGuideModal open={openSetupModal} onClose={() => setOpenSetupModal(false)} />
    </div>
  );
}
