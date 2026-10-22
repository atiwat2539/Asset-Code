import React, { useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
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
  UserPlus,
  LogIn,
  KeyRound,
  ArrowLeft,
  User,
  Briefcase,
} from 'lucide-react';
import { isSupabaseConfigured, recordAuditLog, supabase } from '@/lib/supabase';
import { translateSupabaseError } from '@/lib/utils';
import { useAuth } from './AuthContext';
import { SetupGuideModal } from '@/components/layout/SetupGuideBanner';

type AuthMode = 'login' | 'register' | 'forgot' | 'update-password';

const loginSchema = z.object({
  email: z.string().min(1, 'กรุณากรอกอีเมลราชการหรืออีเมลผู้ใช้งาน').email('รูปแบบอีเมลไม่ถูกต้อง'),
  password: z.string().min(6, 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร'),
});

const registerSchema = z
  .object({
    fullName: z.string().min(2, 'กรุณากรอกชื่อ-นามสกุลผู้ใช้งาน'),
    position: z.string().optional(),
    email: z.string().min(1, 'กรุณากรอกอีเมลผู้ใช้งาน').email('รูปแบบอีเมลไม่ถูกต้อง'),
    password: z.string().min(6, 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร'),
    confirmPassword: z.string().min(6, 'กรุณายืนยันรหัสผ่าน'),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'รหัสผ่านและการยืนยันรหัสผ่านไม่ตรงกัน',
    path: ['confirmPassword'],
  });

const forgotSchema = z.object({
  email: z.string().min(1, 'กรุณากรอกอีเมลที่ใช้ลงทะเบียน').email('รูปแบบอีเมลไม่ถูกต้อง'),
});

const updatePasswordSchema = z
  .object({
    password: z.string().min(6, 'รหัสผ่านใหม่ต้องมีอย่างน้อย 6 ตัวอักษร'),
    confirmPassword: z.string().min(6, 'กรุณายืนยันรหัสผ่านใหม่'),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'รหัสผ่านใหม่และการยืนยันรหัสผ่านไม่ตรงกัน',
    path: ['confirmPassword'],
  });

type LoginFormValues = z.infer<typeof loginSchema>;
type RegisterFormValues = z.infer<typeof registerSchema>;
type ForgotFormValues = z.infer<typeof forgotSchema>;
type UpdatePasswordFormValues = z.infer<typeof updatePasswordSchema>;

export function LoginPage() {
  const { session, isLoading: authLoading, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  const initialMode = (searchParams.get('mode') as AuthMode) || 'login';
  const [mode, setMode] = useState<AuthMode>(
    ['login', 'register', 'forgot', 'update-password'].includes(initialMode) ? initialMode : 'login'
  );

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [openSetupModal, setOpenSetupModal] = useState(false);

  const configured = isSupabaseConfigured();
  const fromPath = (location.state as { from?: { pathname?: string } })?.from?.pathname || '/';

  const loginForm = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const registerForm = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      fullName: '',
      position: '',
      email: '',
      password: '',
      confirmPassword: '',
    },
  });

  const forgotForm = useForm<ForgotFormValues>({
    resolver: zodResolver(forgotSchema),
    defaultValues: { email: '' },
  });

  const updatePasswordForm = useForm<UpdatePasswordFormValues>({
    resolver: zodResolver(updatePasswordSchema),
    defaultValues: { password: '', confirmPassword: '' },
  });

  // ตรวจจับลิงก์กู้คืนรหัสผ่าน (PASSWORD_RECOVERY) จาก Supabase Auth
  useEffect(() => {
    if (!configured) return;

    if (window.location.hash.includes('type=recovery') || searchParams.get('mode') === 'update-password') {
      setMode('update-password');
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setMode('update-password');
        setErrorMessage(null);
        setSuccessMessage('กรุณากำหนดรหัสผ่านใหม่สำหรับบัญชีของคุณ');
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [configured, searchParams]);

  const switchMode = (nextMode: AuthMode, prefillEmail?: string) => {
    setErrorMessage(null);
    setSuccessMessage(null);
    setMode(nextMode);
    if (nextMode === 'login') {
      setSearchParams({});
      if (prefillEmail) {
        loginForm.setValue('email', prefillEmail);
      }
    } else if (nextMode === 'forgot') {
      const currentLoginEmail = loginForm.getValues('email');
      if (currentLoginEmail) {
        forgotForm.setValue('email', currentLoginEmail);
      }
    }
  };

  if (!authLoading && session && mode !== 'update-password') {
    return <Navigate to={fromPath} replace />;
  }

  const ensureConfigured = (): boolean => {
    if (!configured) {
      const msg =
        'ยังไม่ได้ตั้งค่าการเชื่อมต่อ Supabase (.env.local) กรุณาตั้งค่า VITE_SUPABASE_URL และ VITE_SUPABASE_ANON_KEY ก่อนดำเนินการ';
      setErrorMessage(msg);
      toast.error(msg);
      return false;
    }
    return true;
  };

  // 1. เข้าสู่ระบบ
  const onLoginSubmit = async (values: LoginFormValues) => {
    setErrorMessage(null);
    setSuccessMessage(null);
    if (!ensureConfigured()) return;

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

  // 2. สร้างบัญชีผู้ใช้ใหม่ (Sign Up)
  const onRegisterSubmit = async (values: RegisterFormValues) => {
    setErrorMessage(null);
    setSuccessMessage(null);
    if (!ensureConfigured()) return;

    const cleanEmail = values.email.trim().toLowerCase();
    const cleanName = values.fullName.trim();
    const cleanPosition = values.position?.trim() || null;

    try {
      const { data, error } = await supabase.auth.signUp({
        email: cleanEmail,
        password: values.password,
        options: {
          emailRedirectTo: `${window.location.origin}/login`,
          data: {
            full_name: cleanName,
            position: cleanPosition,
          },
        },
      });

      if (error) {
        const friendly = translateSupabaseError(error);
        setErrorMessage(friendly);
        toast.error(friendly);
        return;
      }

      // กรณี Supabase ปิด Confirm Email จะได้ session ทันที
      if (data.user && data.session) {
        await supabase
          .from('profiles')
          .update({
            full_name: cleanName,
            position: cleanPosition,
          })
          .eq('id', data.user.id);

        await refreshProfile();

        await recordAuditLog({
          action: 'AUTH_REGISTER',
          entityType: 'auth',
          entityId: data.user.id,
          summary: `สร้างบัญชีผู้ใช้งานใหม่: ${cleanName} (${cleanEmail})`,
        });

        toast.success('สร้างบัญชีผู้ใช้งานและเข้าสู่ระบบสำเร็จ');
        navigate(fromPath, { replace: true });
        return;
      }

      // กรณีเปิด Confirm Email ใน Supabase ต้องยืนยันผ่านลิงก์ในอีเมลก่อน
      if (data.user) {
        registerForm.reset();
        setMode('login');
        loginForm.setValue('email', cleanEmail);
        const msg = `สร้างบัญชี ${cleanEmail} สำเร็จ! กรุณาตรวจสอบกล่องจดหมายอีเมลของคุณเพื่อกดยืนยันตัวตนก่อนเข้าสู่ระบบ (หรือให้ Admin ยืนยันผ่าน Supabase Dashboard > Authentication > Users)`;
        setSuccessMessage(msg);
        toast.success('สร้างบัญชีผู้ใช้งานสำเร็จ กรุณายืนยันอีเมลก่อนเข้าสู่ระบบ');
      }
    } catch (err) {
      const friendly = translateSupabaseError(err);
      setErrorMessage(friendly);
      toast.error(friendly);
    }
  };

  // 3. ลืมรหัสผ่าน (ส่งอีเมลรีเซ็ตรหัสผ่าน)
  const onForgotSubmit = async (values: ForgotFormValues) => {
    setErrorMessage(null);
    setSuccessMessage(null);
    if (!ensureConfigured()) return;

    const cleanEmail = values.email.trim().toLowerCase();

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
        redirectTo: `${window.location.origin}/login?mode=update-password`,
      });

      if (error) {
        const friendly = translateSupabaseError(error);
        setErrorMessage(friendly);
        toast.error(friendly);
        return;
      }

      const msg = `ส่งลิงก์สำหรับตั้งรหัสผ่านใหม่ไปยัง ${cleanEmail} เรียบร้อยแล้ว กรุณาตรวจสอบกล่องจดหมายและโฟลเดอร์จดหมายขยะ (Spam)`;
      setSuccessMessage(msg);
      toast.success('ส่งลิงก์รีเซ็ตรหัสผ่านไปยังอีเมลแล้ว');
    } catch (err) {
      const friendly = translateSupabaseError(err);
      setErrorMessage(friendly);
      toast.error(friendly);
    }
  };

  // 4. ตั้งรหัสผ่านใหม่ (หลังจากคลิกลิงก์ในอีเมล)
  const onUpdatePasswordSubmit = async (values: UpdatePasswordFormValues) => {
    setErrorMessage(null);
    setSuccessMessage(null);
    if (!ensureConfigured()) return;

    try {
      const { data, error } = await supabase.auth.updateUser({
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
          action: 'AUTH_PASSWORD_RESET',
          entityType: 'auth',
          entityId: data.user.id,
          summary: `ผู้ใช้งาน ${data.user.email} ตั้งรหัสผ่านใหม่สำเร็จ`,
        });
      }

      toast.success('เปลี่ยนรหัสผ่านใหม่เรียบร้อยแล้ว');
      setSearchParams({});
      setMode('login');
      navigate('/', { replace: true });
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

      {/* กล่องหลัก */}
      <div className="flex flex-1 items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl border border-slate-200">
          <div className="bg-gov-800 px-6 py-6 text-center text-white">
            <div className="mx-auto inline-flex items-center justify-center rounded-2xl bg-white px-5 py-3 shadow-lg ring-2 ring-white/30 transition-transform duration-300 hover:scale-105">
              <img
                src="/cmu-library-logo.png"
                alt="CMU Library Logo"
                className="h-14 w-auto object-contain"
              />
            </div>
            <h1 className="mt-3.5 text-xl font-bold tracking-tight">
              ระบบบริหารจัดการครุภัณฑ์สำนักงาน
            </h1>
            <p className="mt-1 text-xs text-sky-100/80">
              CMU Library Asset Management System
            </p>
          </div>

          {/* แท็บสลับ เข้าสู่ระบบ / สร้างบัญชีผู้ใช้ใหม่ */}
          {(mode === 'login' || mode === 'register') && (
            <div className="grid grid-cols-2 border-b border-slate-200 bg-slate-50 p-1.5 gap-1.5">
              <button
                type="button"
                onClick={() => switchMode('login')}
                className={`flex items-center justify-center gap-2 rounded-lg py-2 text-xs font-semibold transition ${
                  mode === 'login'
                    ? 'bg-white text-gov-800 shadow-xs ring-1 ring-slate-200'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <LogIn className="h-4 w-4" />
                เข้าสู่ระบบ
              </button>
              <button
                type="button"
                onClick={() => switchMode('register')}
                className={`flex items-center justify-center gap-2 rounded-lg py-2 text-xs font-semibold transition ${
                  mode === 'register'
                    ? 'bg-white text-gov-800 shadow-xs ring-1 ring-slate-200'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <UserPlus className="h-4 w-4" />
                สร้างบัญชีผู้ใช้ใหม่
              </button>
            </div>
          )}

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

            {successMessage && (
              <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-xs text-emerald-900">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                <span>{successMessage}</span>
              </div>
            )}

            {/* โหมดที่ 1: เข้าสู่ระบบ (Login) */}
            {mode === 'login' && (
              <form onSubmit={loginForm.handleSubmit(onLoginSubmit)} className="space-y-4" noValidate>
                <div>
                  <label htmlFor="login-email" className="block text-xs font-semibold text-slate-700">
                    อีเมลผู้ใช้งาน (Email)
                  </label>
                  <div className="relative mt-1.5">
                    <Mail className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                    <input
                      id="login-email"
                      type="email"
                      autoComplete="email"
                      placeholder="name@agency.go.th"
                      {...loginForm.register('email')}
                      className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-gov-600 focus:outline-none focus:ring-2 focus:ring-gov-600/20"
                    />
                  </div>
                  {loginForm.formState.errors.email && (
                    <p className="mt-1 text-xs text-rose-600">
                      {loginForm.formState.errors.email.message}
                    </p>
                  )}
                </div>

                <div>
                  <div className="flex items-center justify-between">
                    <label
                      htmlFor="login-password"
                      className="block text-xs font-semibold text-slate-700"
                    >
                      รหัสผ่าน (Password)
                    </label>
                    <button
                      type="button"
                      onClick={() => switchMode('forgot')}
                      className="text-xs font-semibold text-gov-700 hover:text-gov-800 hover:underline"
                    >
                      ลืมรหัสผ่าน?
                    </button>
                  </div>
                  <div className="relative mt-1.5">
                    <Lock className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                    <input
                      id="login-password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      placeholder="••••••••"
                      {...loginForm.register('password')}
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
                  {loginForm.formState.errors.password && (
                    <p className="mt-1 text-xs text-rose-600">
                      {loginForm.formState.errors.password.message}
                    </p>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={loginForm.formState.isSubmitting}
                  className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-gov-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-gov-800 disabled:opacity-60"
                >
                  {loginForm.formState.isSubmitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      กำลังตรวจสอบสิทธิ์...
                    </>
                  ) : (
                    <>
                      <LogIn className="h-4 w-4" />
                      เข้าสู่ระบบ
                    </>
                  )}
                </button>

                <div className="pt-2 flex items-center justify-between text-xs text-slate-600">
                  <button
                    type="button"
                    onClick={() => switchMode('register')}
                    className="font-semibold text-gov-700 hover:underline inline-flex items-center gap-1"
                  >
                    <UserPlus className="h-3.5 w-3.5" />
                    สร้างบัญชีผู้ใช้ใหม่
                  </button>
                  <button
                    type="button"
                    onClick={() => switchMode('forgot')}
                    className="text-slate-500 hover:text-slate-800 hover:underline inline-flex items-center gap-1"
                  >
                    <KeyRound className="h-3.5 w-3.5" />
                    กู้คืนรหัสผ่าน
                  </button>
                </div>
              </form>
            )}

            {/* โหมดที่ 2: สร้างบัญชีผู้ใช้ใหม่ (Register / Sign Up) */}
            {mode === 'register' && (
              <form
                onSubmit={registerForm.handleSubmit(onRegisterSubmit)}
                className="space-y-3.5"
                noValidate
              >
                <div>
                  <label htmlFor="reg-fullname" className="block text-xs font-semibold text-slate-700">
                    ชื่อ-นามสกุล <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative mt-1">
                    <User className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                    <input
                      id="reg-fullname"
                      type="text"
                      placeholder="เช่น นายสมชาย ใจดี"
                      {...registerForm.register('fullName')}
                      className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-gov-600 focus:outline-none focus:ring-2 focus:ring-gov-600/20"
                    />
                  </div>
                  {registerForm.formState.errors.fullName && (
                    <p className="mt-1 text-xs text-rose-600">
                      {registerForm.formState.errors.fullName.message}
                    </p>
                  )}
                </div>

                <div>
                  <label htmlFor="reg-position" className="block text-xs font-semibold text-slate-700">
                    ตำแหน่งราชการ / ฝ่าย (ไม่บังคับ)
                  </label>
                  <div className="relative mt-1">
                    <Briefcase className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                    <input
                      id="reg-position"
                      type="text"
                      placeholder="เช่น นักวิชาการพัสดุปฏิบัติการ"
                      {...registerForm.register('position')}
                      className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-gov-600 focus:outline-none focus:ring-2 focus:ring-gov-600/20"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="reg-email" className="block text-xs font-semibold text-slate-700">
                    อีเมลผู้ใช้งาน (Email) <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative mt-1">
                    <Mail className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                    <input
                      id="reg-email"
                      type="email"
                      autoComplete="email"
                      placeholder="name@agency.go.th"
                      {...registerForm.register('email')}
                      className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-gov-600 focus:outline-none focus:ring-2 focus:ring-gov-600/20"
                    />
                  </div>
                  {registerForm.formState.errors.email && (
                    <p className="mt-1 text-xs text-rose-600">
                      {registerForm.formState.errors.email.message}
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor="reg-password"
                      className="block text-xs font-semibold text-slate-700"
                    >
                      รหัสผ่าน <span className="text-rose-500">*</span>
                    </label>
                    <div className="relative mt-1">
                      <Lock className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                      <input
                        id="reg-password"
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                        placeholder="อย่างน้อย 6 ตัว"
                        {...registerForm.register('password')}
                        className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-8 text-sm text-slate-900 placeholder:text-slate-400 focus:border-gov-600 focus:outline-none focus:ring-2 focus:ring-gov-600/20"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((prev) => !prev)}
                        className="absolute right-2 top-2 rounded p-0.5 text-slate-400 hover:text-slate-600"
                      >
                        {showPassword ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                    {registerForm.formState.errors.password && (
                      <p className="mt-1 text-xs text-rose-600">
                        {registerForm.formState.errors.password.message}
                      </p>
                    )}
                  </div>

                  <div>
                    <label
                      htmlFor="reg-confirm-password"
                      className="block text-xs font-semibold text-slate-700"
                    >
                      ยืนยันรหัสผ่าน <span className="text-rose-500">*</span>
                    </label>
                    <div className="relative mt-1">
                      <Lock className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                      <input
                        id="reg-confirm-password"
                        type={showConfirmPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                        placeholder="กรอกซ้ำอีกครั้ง"
                        {...registerForm.register('confirmPassword')}
                        className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-8 text-sm text-slate-900 placeholder:text-slate-400 focus:border-gov-600 focus:outline-none focus:ring-2 focus:ring-gov-600/20"
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirmPassword((prev) => !prev)}
                        className="absolute right-2 top-2 rounded p-0.5 text-slate-400 hover:text-slate-600"
                      >
                        {showConfirmPassword ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                    {registerForm.formState.errors.confirmPassword && (
                      <p className="mt-1 text-xs text-rose-600">
                        {registerForm.formState.errors.confirmPassword.message}
                      </p>
                    )}
                  </div>
                </div>

                <div className="rounded-lg bg-slate-50 p-2.5 text-[11px] text-slate-600 border border-slate-200">
                  บัญชีที่สร้างใหม่จะได้รับสิทธิ์เริ่มต้นเป็น{' '}
                  <span className="font-semibold text-slate-800">บุคลากรทั่วไป (Requester)</span>{' '}
                  โดยอัตโนมัติตามนโยบายความปลอดภัย และผู้ดูแลระบบสามารถยกระดับสิทธิ์ภายหลังได้
                </div>

                <button
                  type="submit"
                  disabled={registerForm.formState.isSubmitting}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-gov-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-gov-800 disabled:opacity-60"
                >
                  {registerForm.formState.isSubmitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      กำลังสร้างบัญชีผู้ใช้งาน...
                    </>
                  ) : (
                    <>
                      <UserPlus className="h-4 w-4" />
                      ยืนยันการสร้างบัญชีผู้ใช้
                    </>
                  )}
                </button>
              </form>
            )}

            {/* โหมดที่ 3: ลืมรหัสผ่าน (Forgot Password) */}
            {mode === 'forgot' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div className="flex items-center gap-2 text-sm font-bold text-slate-800">
                    <KeyRound className="h-4 w-4 text-gov-700" />
                    <span>ลืมรหัสผ่าน / ขอลิงก์ตั้งรหัสผ่านใหม่</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => switchMode('login')}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-slate-900"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                    กลับหน้าเข้าสู่ระบบ
                  </button>
                </div>

                <p className="text-xs text-slate-600 leading-relaxed">
                  กรอกอีเมลที่ใช้ลงทะเบียนในระบบ ระบบจะส่งลิงก์สำหรับกำหนดรหัสผ่านใหม่ไปยังกล่องจดหมายของคุณ
                </p>

                <form
                  onSubmit={forgotForm.handleSubmit(onForgotSubmit)}
                  className="space-y-4"
                  noValidate
                >
                  <div>
                    <label
                      htmlFor="forgot-email"
                      className="block text-xs font-semibold text-slate-700"
                    >
                      อีเมลที่ลงทะเบียนไว้ (Email)
                    </label>
                    <div className="relative mt-1.5">
                      <Mail className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                      <input
                        id="forgot-email"
                        type="email"
                        autoComplete="email"
                        placeholder="name@agency.go.th"
                        {...forgotForm.register('email')}
                        className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-gov-600 focus:outline-none focus:ring-2 focus:ring-gov-600/20"
                      />
                    </div>
                    {forgotForm.formState.errors.email && (
                      <p className="mt-1 text-xs text-rose-600">
                        {forgotForm.formState.errors.email.message}
                      </p>
                    )}
                  </div>

                  <button
                    type="submit"
                    disabled={forgotForm.formState.isSubmitting}
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-gov-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-gov-800 disabled:opacity-60"
                  >
                    {forgotForm.formState.isSubmitting ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        กำลังส่งลิงก์ไปยังอีเมล...
                      </>
                    ) : (
                      'ส่งลิงก์ตั้งรหัสผ่านใหม่'
                    )}
                  </button>
                </form>
              </div>
            )}

            {/* โหมดที่ 4: ตั้งรหัสผ่านใหม่ (Update Password หลังกดลิงก์จากอีเมล) */}
            {mode === 'update-password' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div className="flex items-center gap-2 text-sm font-bold text-slate-800">
                    <KeyRound className="h-4 w-4 text-gov-700" />
                    <span>กำหนดรหัสผ่านใหม่</span>
                  </div>
                </div>

                <form
                  onSubmit={updatePasswordForm.handleSubmit(onUpdatePasswordSubmit)}
                  className="space-y-4"
                  noValidate
                >
                  <div>
                    <label
                      htmlFor="new-password"
                      className="block text-xs font-semibold text-slate-700"
                    >
                      รหัสผ่านใหม่ (อย่างน้อย 6 ตัวอักษร)
                    </label>
                    <div className="relative mt-1.5">
                      <Lock className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                      <input
                        id="new-password"
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                        placeholder="••••••••"
                        {...updatePasswordForm.register('password')}
                        className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-10 text-sm text-slate-900 placeholder:text-slate-400 focus:border-gov-600 focus:outline-none focus:ring-2 focus:ring-gov-600/20"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((prev) => !prev)}
                        className="absolute right-2.5 top-2 rounded p-0.5 text-slate-400 hover:text-slate-600"
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    {updatePasswordForm.formState.errors.password && (
                      <p className="mt-1 text-xs text-rose-600">
                        {updatePasswordForm.formState.errors.password.message}
                      </p>
                    )}
                  </div>

                  <div>
                    <label
                      htmlFor="confirm-new-password"
                      className="block text-xs font-semibold text-slate-700"
                    >
                      ยืนยันรหัสผ่านใหม่
                    </label>
                    <div className="relative mt-1.5">
                      <Lock className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                      <input
                        id="confirm-new-password"
                        type={showConfirmPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                        placeholder="••••••••"
                        {...updatePasswordForm.register('confirmPassword')}
                        className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-10 text-sm text-slate-900 placeholder:text-slate-400 focus:border-gov-600 focus:outline-none focus:ring-2 focus:ring-gov-600/20"
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirmPassword((prev) => !prev)}
                        className="absolute right-2.5 top-2 rounded p-0.5 text-slate-400 hover:text-slate-600"
                      >
                        {showConfirmPassword ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                    {updatePasswordForm.formState.errors.confirmPassword && (
                      <p className="mt-1 text-xs text-rose-600">
                        {updatePasswordForm.formState.errors.confirmPassword.message}
                      </p>
                    )}
                  </div>

                  <button
                    type="submit"
                    disabled={updatePasswordForm.formState.isSubmitting}
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-gov-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-gov-800 disabled:opacity-60"
                  >
                    {updatePasswordForm.formState.isSubmitting ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        กำลังบันทึกรหัสผ่านใหม่...
                      </>
                    ) : (
                      'บันทึกรหัสผ่านใหม่'
                    )}
                  </button>
                </form>
              </div>
            )}

            <div className="mt-6 border-t border-slate-100 pt-4 text-center text-xs text-slate-500 space-y-1">
              <p>การกำหนดสิทธิ์ผู้ใช้งานควบคุมโดยผู้ดูแลระบบ (Admin) และบังคับใช้ผ่าน Supabase RLS</p>
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
