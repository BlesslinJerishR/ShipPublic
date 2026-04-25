'use client';

import { useEffect, useState } from 'react';
import { Save, RotateCcw, Pencil } from 'lucide-react';
import { Card } from '@/components/Card';
import {
  DEFAULT_SIGNATURE,
  getSettings,
  updateSettings,
  type UserSettings,
} from '@/lib/settings';

export default function SettingsPage() {
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [signature, setSignature] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    const s = getSettings();
    setSettings(s);
    setSignature(s.signature);
    setEnabled(s.signatureEnabled);
  }, []);

  if (!settings) return <div style={{ opacity: 0.6 }}>Loading settings…</div>;

  const dirty =
    signature !== settings.signature || enabled !== settings.signatureEnabled;

  const save = () => {
    const next = updateSettings({
      signature: signature.trim() || DEFAULT_SIGNATURE,
      signatureEnabled: enabled,
    });
    setSettings(next);
    setSignature(next.signature);
    setSavedAt(Date.now());
  };

  const reset = () => {
    setSignature(DEFAULT_SIGNATURE);
    setEnabled(true);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 720 }}>
      <div>
        <h2 style={{ margin: 0 }}>Settings</h2>
        <div style={{ opacity: 0.65, fontSize: 13, marginTop: 4 }}>
          Personalise the touches Shipublic adds to every generated post.
        </div>
      </div>

      <Card title="Post signature" action={<Pencil size={14} />}>
        <p style={{ margin: '0 0 10px 0', fontSize: 13, opacity: 0.75 }}>
          Appended as the last line of every generated and saved post. Edit it to
          fit your voice or disable it entirely.
        </p>

        <label
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 10,
            fontSize: 13,
            marginBottom: 12,
            cursor: 'pointer',
            userSelect: 'none',
          }}
        >
          <input
            type="checkbox"
            className="redCheck"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          <span>Append signature to every post</span>
        </label>

        <textarea
          value={signature}
          onChange={(e) => setSignature(e.target.value)}
          rows={3}
          placeholder={DEFAULT_SIGNATURE}
          style={{
            width: '100%',
            resize: 'vertical',
            fontFamily: 'inherit',
            opacity: enabled ? 1 : 0.5,
          }}
          disabled={!enabled}
        />
        <div style={{ fontSize: 11.5, opacity: 0.6, marginTop: 6 }}>
          Default: <span style={{ fontFamily: 'ui-monospace, monospace' }}>{DEFAULT_SIGNATURE}</span>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="heroBtn" onClick={save} disabled={!dirty}>
            <Save size={14} /> Save changes
          </button>
          <button onClick={reset} disabled={signature === DEFAULT_SIGNATURE && enabled}>
            <RotateCcw size={14} /> Reset to default
          </button>
          {savedAt && !dirty && (
            <span style={{ fontSize: 12, color: 'var(--hero)' }}>Saved.</span>
          )}
        </div>
      </Card>
    </div>
  );
}
