import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { isSupabaseConfigured, recordAuditLog, supabase } from '@/lib/supabase';
import type { Profile, UserRole } from '@/types/database';

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  role: UserRole;
  isLoading: boolean;
  isConfigured: boolean;
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
  const configured = isSupabaseConfigured();

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
      setSession(currentSession);
      setUser(currentSession?.user ?? null);
      if (currentSession?.user) {
        await fetchProfile(currentSession.user.id, currentSession.user.email);
      }
      if (mounted) setIsLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      if (!mounted) return;
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
