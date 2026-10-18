import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { Profile, SiteSettings } from './types';

interface AuthState {
  session: Session | null;
  profile: Profile | null;
  settings: SiteSettings | null;
  loading: boolean;
  isAdmin: boolean;
  canInspect: boolean;
  isScaffolder: boolean;
  /** Admins, inspectors and scaffolders can submit a fix photo. */
  canFix: boolean;
  refreshProfile: () => Promise<void>;
  refreshSettings: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [settings, setSettings] = useState<SiteSettings | null>(null);
  const [profileLoadedFor, setProfileLoadedFor] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setSessionLoaded(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setSessionLoaded(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id ?? null;

  const refreshProfile = useCallback(async () => {
    if (!userId) {
      setProfile(null);
      setProfileLoadedFor(null);
      return;
    }
    const { data } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
    setProfile((data as Profile | null) ?? null);
    setProfileLoadedFor(userId);
  }, [userId]);

  const refreshSettings = useCallback(async () => {
    if (!userId) return setSettings(null);
    const { data } = await supabase.from('site_settings').select('*').eq('id', 1).maybeSingle();
    setSettings((data as SiteSettings | null) ?? null);
  }, [userId]);

  useEffect(() => {
    void refreshProfile();
    void refreshSettings();
  }, [refreshProfile, refreshSettings]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setProfile(null);
  }, []);

  const role = profile?.role;
  const value: AuthState = {
    session,
    profile,
    settings,
    loading: !sessionLoaded || (Boolean(userId) && profileLoadedFor !== userId),
    isAdmin: role === 'admin',
    canInspect: role === 'admin' || role === 'inspector',
    isScaffolder: role === 'scaffolder',
    canFix: role === 'admin' || role === 'inspector' || role === 'scaffolder',
    refreshProfile,
    refreshSettings,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
