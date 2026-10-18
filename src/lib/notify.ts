import { supabase } from './supabase';

export type NotifyEvent = 'snags_submitted' | 'fix_submitted' | 'fix_reviewed' | 'test';

/** Asks the server to send push notifications / emails. Never throws: notifications must not block site work. */
export async function sendNotification(
  event: NotifyEvent,
  payload: Record<string, string> = {},
): Promise<{ push?: number; email?: number; error?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke('notify', {
      body: { event, ...payload, app_url: window.location.origin },
    });
    if (error) return { error: error.message };
    return (data as { push?: number; email?: number }) ?? {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Notification failed' };
  }
}
