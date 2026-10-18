import { useState } from 'react';
import Modal from './Modal';
import CameraField, { type CapturedPhoto } from './CameraField';
import { supabase } from '../lib/supabase';
import { uploadPhoto } from '../lib/photo';
import { useAuth } from '../lib/auth';
import type { Inspection, Snag } from '../lib/types';

const ELEVATIONS = ['Front', 'Rear', 'Left side', 'Right side', 'Gable', 'Roof level', 'Access / ladder', 'Loading bay'];

export default function SnagModal({
  inspection,
  inspectionItemId,
  defaultDescription,
  lift = '',
  onSaved,
  onClose,
}: {
  inspection: Inspection;
  inspectionItemId: string | null;
  defaultDescription: string;
  lift?: string;
  onSaved: (snag: Snag) => void;
  onClose: () => void;
}) {
  const { profile } = useAuth();
  const plots = inspection.plot_numbers;
  const [plot, setPlot] = useState<string>(plots.length === 1 ? plots[0] : '');
  const [elevation, setElevation] = useState('');
  const [description, setDescription] = useState(defaultDescription);
  const [photo, setPhoto] = useState<CapturedPhoto | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const location = [plot ? `Plot ${plot}` : '', lift, elevation].filter(Boolean).join(' - ');
  const inspector = profile?.full_name || profile?.email || 'Inspector';

  async function save() {
    if (!photo) return setError('Take a photo of the snag first.');
    if (!description.trim()) return setError('Describe the snag.');
    setSaving(true);
    setError(null);
    try {
      const path = await uploadPhoto(inspection.id, photo.blob);
      const { data, error: err } = await supabase
        .from('snags')
        .insert({
          inspection_id: inspection.id,
          inspection_item_id: inspectionItemId,
          scaffold_name: inspection.scaffold_name,
          location,
          description: description.trim(),
          photo_path: path,
          latitude: photo.fix?.latitude ?? null,
          longitude: photo.fix?.longitude ?? null,
          accuracy_m: photo.fix?.accuracy ?? null,
          taken_at: photo.takenAt.toISOString(),
          created_by: profile?.id ?? null,
        })
        .select()
        .single();
      if (err) throw err;
      onSaved(data as Snag);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save snag');
      setSaving(false);
    }
  }

  return (
    <Modal
      title={lift ? `Add snag - ${lift}` : 'Add snag'}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => void save()} disabled={saving || !photo}>
            {saving ? 'Saving...' : 'Save snag'}
          </button>
        </>
      }
    >
      {plots.length > 1 && (
        <div className="field">
          <label>Plot</label>
          <div className="chips">
            {plots.map((p) => (
              <button key={p} type="button" className={`chip ${plot === p ? 'on' : ''}`} onClick={() => setPlot(plot === p ? '' : p)}>
                {p}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="field">
        <label>Where</label>
        <div className="chips">
          {ELEVATIONS.map((el) => (
            <button
              key={el}
              type="button"
              className={`chip ${elevation === el ? 'on' : ''}`}
              onClick={() => setElevation(elevation === el ? '' : el)}
            >
              {el}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <label htmlFor="snag-desc">What's wrong</label>
        <textarea
          id="snag-desc"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="e.g. Toe board missing on first lift"
        />
      </div>
      <div className="field">
        <label>Photo (geo-tagged)</label>
        <CameraField
          stamp={{ title: inspection.scaffold_name, subtitle: location || undefined, inspector }}
          value={photo}
          onChange={setPhoto}
          allowNoGps
        />
      </div>
      {error && <div className="alert alert-error">{error}</div>}
    </Modal>
  );
}
