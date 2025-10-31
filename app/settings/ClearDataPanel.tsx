'use client';

import { useRef, useState } from 'react';

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
    <section className="card bg-base-100 shadow">
      <div className="card-body gap-3">
        <h2 className="card-title">Privacy & Data</h2>
        <p className="text-sm opacity-70">Remove all stored resources and embeddings associated with your account.</p>
        <div className="card-actions">
          <button type="button" className="btn btn-error" onClick={open}>Delete my stored data</button>
        </div>
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
    </section>
  );
}


