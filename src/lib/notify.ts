import { supabase } from './supabase';

export type NotifyEvent = 'snags_submitted' | 'fix_submitted' | 'fix_reviewed' | 'test';

export interface NotifyResult {
  push?: number;
  push_devices?: number;
  push_errors?: string[];
  email?: number;
  /** Seconds until a delayed test is sent. */
  scheduled?: number;
  error?: string;
}

/** Asks the server to send push notifications / emails. Never throws: notifications must not block site work. */
export async function sendNotification(event: NotifyEvent, payload: Record<string, string> = {}): Promise<NotifyResult> {
  try {
    const { data, error } = await supabase.functions.invoke('notify', {
      body: { event, ...payload, app_url: window.location.origin },
    });
    if (error) return { error: error.message };
    return (data as NotifyResult) ?? {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Notification failed' };
  }
}
