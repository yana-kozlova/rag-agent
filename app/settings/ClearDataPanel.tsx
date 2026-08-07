'use client';

import { useRef, useState } from 'react';
import { SettingsSection } from './ui';

export default function ClearDataPanel() {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<null | { ok: boolean; deletedResources?: number; deletedEmbeddings?: number; error?: string }>(null);

  const open = () => dialogRef.current?.showModal();
  const close = () => dialogRef.current?.close();

  const onConfirm = async () => {
    try {
      setLoading(true);
      setResult(null);
      const res = await fetch('/api/resources/clear', { method: 'DELETE' });
      const json = await res.json().catch(() => ({}));
      setResult(json);
      if (res.ok) {
        // small delay to show the result then close
        setTimeout(() => {
          close();
        }, 1500);
      }
    } catch (e: any) {
      setResult({ ok: false, error: e?.message || 'unknown error' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <SettingsSection
      id="data"
      title="Privacy & Data"
      description="Everything you have saved lives on this account and nowhere else."
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-base-content/60">
          Remove all stored resources and their embeddings.
        </p>
        <button type="button" className="btn btn-outline btn-error btn-sm" onClick={open}>
          Delete my stored data
        </button>
      </div>

      <dialog ref={dialogRef} className="modal">
        <div className="modal-box">
          <h3 className="font-bold text-lg">Confirm deletion</h3>
          <p className="py-2 text-sm">This will permanently delete all your saved resources and their embeddings. This cannot be undone.</p>
          {result && (
            <div className={`alert ${result.ok ? 'alert-success' : 'alert-warning'} mt-2 text-sm`}>
              {result.ok ? (
                <span>Deleted resources: {result.deletedResources} · embeddings: {result.deletedEmbeddings}</span>
              ) : (
                <span>Failed: {result.error || 'unknown error'}</span>
              )}
            </div>
          )}
          <div className="modal-action">
            <button type="button" className="btn btn-ghost" onClick={close} disabled={loading}>Cancel</button>
            <button type="button" className={`btn btn-error ${loading ? 'loading' : ''}`} onClick={onConfirm} disabled={loading}>
              {loading ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </div>
        <form method="dialog" className="modal-backdrop">
          <button>close</button>
        </form>
      </dialog>
    </SettingsSection>
  );
}


