import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { toast } from 'sonner';
import { isSupabaseConfigured, recordAuditLog, supabase } from '@/lib/supabase';
import type { Profile, UserRole } from '@/types/database';

/** กำหนดเวลา Session Timeout ที่ 15 นาที (900,000 มิลลิวินาที) */
export const SESSION_TIMEOUT_MS = 15 * 60 * 1000;
export const SESSION_TIMEOUT_SECONDS = 15 * 60;
const LAST_ACTIVITY_STORAGE_KEY = 'cmu_library_last_activity_ts';

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  role: UserRole;
  isLoading: boolean;
  isConfigured: boolean;
  remainingSessionSeconds: number;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  hasRole: (allowedRoles: UserRole[]) => boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [remainingSessionSeconds, setRemainingSessionSeconds] = useState<number>(SESSION_TIMEOUT_SECONDS);
  const configured = isSupabaseConfigured();
  const isTimingOutRef = useRef(false);

  const fetchProfile = useCallback(async (userId: string, userEmail?: string) => {
    if (!configured) {
      setProfile(null);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*, department:departments(*)')
        .eq('id', userId)
        .maybeSingle();

      if (error) {
        console.error('Error loading profile:', error);
      }

      if (data) {
        setProfile(data as Profile);
      } else {
        // Fallback หากยังไม่มีแถวใน profiles ให้แสดงสิทธิ์เริ่มต้นเป็น requester
        setProfile({
          id: userId,
          email: userEmail || '',
          full_name: userEmail ? userEmail.split('@')[0] : 'ผู้ใช้งานระบบ',
          role: 'requester',
          department_id: null,
          position: null,
          phone: null,
          is_active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }
    } catch (err) {
      console.error('Unexpected profile load error:', err);
    }
  }, [configured]);

  useEffect(() => {
    if (!configured) {
      setIsLoading(false);
      return;
    }

    let mounted = true;

    supabase.auth.getSession().then(async ({ data: { session: currentSession } }) => {
      if (!mounted) return;

      if (currentSession?.user) {
        const storedTs = Number(localStorage.getItem(LAST_ACTIVITY_STORAGE_KEY) || 0);
        const now = Date.now();
        if (storedTs > 0 && now - storedTs >= SESSION_TIMEOUT_MS) {
          // หากเคยเปิดค้างไว้และเกิน 15 นาทีแล้ว ให้ออกจากระบบทันที
          localStorage.removeItem(LAST_ACTIVITY_STORAGE_KEY);
          await supabase.auth.signOut();
          if (mounted) {
            setSession(null);
            setUser(null);
            setProfile(null);
            setIsLoading(false);
            toast.warning('เซสชันหมดอายุเนื่องจากไม่มีการใช้งานเกิน 15 นาที กรุณาเข้าสู่ระบบใหม่');
          }
          return;
        }
        localStorage.setItem(LAST_ACTIVITY_STORAGE_KEY, String(now));
      }

      setSession(currentSession);
      setUser(currentSession?.user ?? null);
      if (currentSession?.user) {
        await fetchProfile(currentSession.user.id, currentSession.user.email);
      }
      if (mounted) setIsLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, newSession) => {
      if (!mounted) return;
      if (event === 'SIGNED_IN' && newSession?.user) {
        localStorage.setItem(LAST_ACTIVITY_STORAGE_KEY, String(Date.now()));
        setRemainingSessionSeconds(SESSION_TIMEOUT_SECONDS);
        isTimingOutRef.current = false;
      } else if (event === 'SIGNED_OUT') {
        localStorage.removeItem(LAST_ACTIVITY_STORAGE_KEY);
      }

      setSession(newSession);
      setUser(newSession?.user ?? null);
      if (newSession?.user) {
        await fetchProfile(newSession.user.id, newSession.user.email);
      } else {
        setProfile(null);
      }
      setIsLoading(false);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [configured, fetchProfile]);

  const refreshProfile = useCallback(async () => {
    if (user) {
      await fetchProfile(user.id, user.email);
    }
  }, [user, fetchProfile]);

  const signOut = useCallback(async () => {
    localStorage.removeItem(LAST_ACTIVITY_STORAGE_KEY);
    if (configured) {
      await recordAuditLog({
        action: 'AUTH_LOGOUT',
        entityType: 'auth',
        entityId: user?.id,
        summary: `ผู้ใช้งาน ${profile?.email || user?.email || ''} ออกจากระบบ`,
      });
      await supabase.auth.signOut();
    }
    setSession(null);
    setUser(null);
    setProfile(null);
  }, [configured, user, profile]);

  // ระบบตรวจจับความเคลื่อนไหวและตัดเซสชันอัตโนมัติเมื่อไม่มีการใช้งานครบ 15 นาที
  useEffect(() => {
    if (!configured || !user) {
      setRemainingSessionSeconds(SESSION_TIMEOUT_SECONDS);
      return;
    }

    if (!localStorage.getItem(LAST_ACTIVITY_STORAGE_KEY)) {
      localStorage.setItem(LAST_ACTIVITY_STORAGE_KEY, String(Date.now()));
    }

    let lastWrite = Date.now();
    const recordActivity = () => {
      const now = Date.now();
      // บันทึกความเคลื่อนไหวอย่างน้อยทุกๆ 2 วินาทีเพื่อประสิทธิภาพสูงสุด
      if (now - lastWrite >= 2000) {
        lastWrite = now;
        localStorage.setItem(LAST_ACTIVITY_STORAGE_KEY, String(now));
        setRemainingSessionSeconds(SESSION_TIMEOUT_SECONDS);
      }
    };

    const activityEvents: (keyof WindowEventMap)[] = [
      'mousemove',
      'mousedown',
      'keydown',
      'scroll',
      'touchstart',
      'click',
      'focus',
    ];

    activityEvents.forEach((evt) => window.addEventListener(evt, recordActivity, { passive: true }));

    const intervalId = window.setInterval(async () => {
      const lastTs = Number(localStorage.getItem(LAST_ACTIVITY_STORAGE_KEY) || Date.now());
      const elapsedMs = Date.now() - lastTs;
      const leftSec = Math.max(0, Math.ceil((SESSION_TIMEOUT_MS - elapsedMs) / 1000));
      setRemainingSessionSeconds(leftSec);

      if (elapsedMs >= SESSION_TIMEOUT_MS && !isTimingOutRef.current) {
        isTimingOutRef.current = true;
        localStorage.removeItem(LAST_ACTIVITY_STORAGE_KEY);

        try {
          await recordAuditLog({
            action: 'AUTH_SESSION_TIMEOUT',
            entityType: 'auth',
            entityId: user.id,
            summary: `ตัดเซสชันอัตโนมัติเนื่องจากไม่มีการใช้งานเกิน 15 นาที (${profile?.email || user.email || ''})`,
          });
          await supabase.auth.signOut();
        } catch (err) {
          console.error('Session timeout signout error:', err);
        }

        setSession(null);
        setUser(null);
        setProfile(null);
        toast.warning('หมดเวลาเซสชัน (ไม่มีการใช้งานเกิน 15 นาที) ระบบได้ออกจากระบบอัตโนมัติ');
      }
    }, 1000);

    return () => {
      activityEvents.forEach((evt) => window.removeEventListener(evt, recordActivity));
      window.clearInterval(intervalId);
    };
  }, [configured, user, profile]);

  const role: UserRole = profile?.role || 'requester';

  const hasRole = useCallback(
    (allowedRoles: UserRole[]) => {
      return allowedRoles.includes(role);
    },
    [role]
  );

  return (
    <AuthContext.Provider
      value={{
        session,
        user,
        profile,
        role,
        isLoading,
        isConfigured: configured,
        remainingSessionSeconds,
        signOut,
        refreshProfile,
        hasRole,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth ต้องถูกเรียกใช้งานภายใน <AuthProvider>');
  }
  return ctx;
}
