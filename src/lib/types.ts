export type Role = 'admin' | 'inspector' | 'viewer' | 'scaffolder' | 'pending';

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  created_at: string;
}

export interface SiteSettings {
  id: number;
  site_name: string;
  company_name: string;
  manager_name: string;
  manager_email: string;
  manager_phone: string;
  fix_hours: number;
  purge_reminder_days: number;
  last_purged_at: string | null;
  check_days: number;
  /** Fix photos further than this from the original snag photo need approval. */
  geofence_m: number;
  vapid_public_key: string;
  app_url: string;
}

export type ScaffoldKind = 'single' | 'pair' | 'block';

export interface Scaffold {
  id: string;
  name: string;
  kind: ScaffoldKind;
  plot_numbers: string[];
  /** Number of lifts below the table lift. */
  lifts: number;
  active: boolean;
  notes: string;
  created_at: string;
  finished_at: string | null;
  last_checked_at: string | null;
}

/** once = whole scaffold, every = each lift and the table lift, table = table lift only. */
export type ItemApplies = 'once' | 'every' | 'table';

export interface ChecklistItem {
  id: string;
  section: string;
  text: string;
  sort_order: number;
  applies: ItemApplies;
  active: boolean;
}

export type InspectionStatus = 'in_progress' | 'completed';

export interface Inspection {
  id: string;
  scaffold_id: string | null;
  scaffold_name: string;
  plot_numbers: string[];
  inspector_id: string | null;
  inspector_name: string;
  status: InspectionStatus;
  started_at: string;
  completed_at: string | null;
  sent_at: string | null;
  notes: string;
}

export type ItemResult = 'pass' | 'fail' | 'na';

export interface InspectionItem {
  id: string;
  inspection_id: string;
  item_id: string | null;
  section: string;
  text: string;
  sort_order: number;
  /** '' for whole-scaffold items, otherwise e.g. "1st lift" or "Table lift". */
  lift: string;
  lift_order: number;
  result: ItemResult | null;
  note: string;
}

export interface Snag {
  id: string;
  inspection_id: string;
  inspection_item_id: string | null;
  scaffold_name: string;
  location: string;
  description: string;
  photo_path: string | null;
  latitude: number | null;
  longitude: number | null;
  accuracy_m: number | null;
  taken_at: string | null;
  status: SnagStatus;
  due_at: string | null;
  closed_at: string | null;
  closed_by_name: string | null;
  close_note: string;
  close_photo_path: string | null;
  close_latitude: number | null;
  close_longitude: number | null;
  close_accuracy_m: number | null;
  close_taken_at: string | null;
  close_context_photo_path: string | null;
  close_location_source: 'gps' | 'last_known' | 'none' | null;
  close_distance_m: number | null;
  close_flags: string[];
  close_submitted_at: string | null;
  /** 'gps' = verified automatically, 'approved' = approved by the site manager. */
  close_verified: 'gps' | 'approved' | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  reject_note: string;
  created_by: string | null;
  created_at: string;
}

export type SnagStatus = 'open' | 'pending_approval' | 'closed';
