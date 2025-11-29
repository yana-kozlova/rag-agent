'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createUserTable } from '@/lib/actions/user-tables';
import Link from 'next/link';
import type { TableColumn } from '@/lib/db/schema/user-tables';

export default function NewTablePage() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [columns, setColumns] = useState<TableColumn[]>([
    { id: 'col1', name: 'Column 1', type: 'text' }
  ]);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const addColumn = () => {
    const newId = `col${Date.now()}`;
    setColumns([...columns, { id: newId, name: `Column ${columns.length + 1}`, type: 'text' }]);
  };

  const removeColumn = (id: string) => {
    if (columns.length > 1) {
      setColumns(columns.filter(col => col.id !== id));
    }
  };

  const updateColumn = (id: string, updates: Partial<TableColumn>) => {
    setColumns(columns.map(col => col.id === id ? { ...col, ...updates } : col));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setToast({ message: 'Please enter a title', type: 'error' });
      return;
    }

    setLoading(true);
    try {
      const result = await createUserTable({
        title: title.trim(),
        description: description.trim() || undefined,
        columns,
        settings: {
          sortable: true,
          filterable: true,
          editable: true,
        },
      });

      if (result.success) {
        router.push(`/tables/${result.id}`);
      } else {
        setToast({ message: result.message || 'Failed to create table', type: 'error' });
      }
    } catch (error) {
      setToast({ message: 'Failed to create table', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container mx-auto p-4 md:p-6 max-w-4xl">
      {toast && (
        <div className={`alert ${toast.type === 'success' ? 'alert-success' : 'alert-error'} shadow-lg fixed top-4 right-4 z-50 max-w-md`}>
          <span>{toast.message}</span>
          <button className="btn btn-sm btn-ghost" onClick={() => setToast(null)}>×</button>
        </div>
      )}
      
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Create New Table</h1>
        <Link href="/tables" className="btn btn-outline btn-sm">
          Back to Tables
        </Link>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label className="label">
            <span className="label-text">Table Title *</span>
          </label>
          <input
            type="text"
            className="input input-bordered w-full"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="My Table"
            required
          />
        </div>

        <div>
          <label className="label">
            <span className="label-text">Description</span>
          </label>
          <textarea
            className="textarea textarea-bordered w-full"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional description"
            rows={3}
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-4">
            <label className="label">
              <span className="label-text font-semibold">Columns *</span>
            </label>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={addColumn}
            >
              Add Column
            </button>
          </div>

          <div className="space-y-3">
            {columns.map((column, index) => (
              <div key={column.id} className="card bg-base-200 p-4">
                <div className="grid grid-cols-12 gap-2 items-end">
                  <div className="col-span-4">
                    <label className="label">
                      <span className="label-text text-xs">Column Name</span>
                    </label>
                    <input
                      type="text"
                      className="input input-bordered input-sm w-full"
                      value={column.name}
                      onChange={(e) => updateColumn(column.id, { name: e.target.value })}
                      placeholder="Column name"
                      required
                    />
                  </div>
                  <div className="col-span-3">
                    <label className="label">
                      <span className="label-text text-xs">Type</span>
                    </label>
                    <select
                      className="select select-bordered select-sm w-full"
                      value={column.type}
                      onChange={(e) => updateColumn(column.id, { type: e.target.value as TableColumn['type'] })}
                    >
                      <option value="text">Text</option>
                      <option value="number">Number</option>
                      <option value="date">Date</option>
                      <option value="boolean">Boolean</option>
                      <option value="email">Email</option>
                      <option value="url">URL</option>
                    </select>
                  </div>
                  <div className="col-span-2">
                    <label className="label">
                      <span className="label-text text-xs">Width</span>
                    </label>
                    <input
                      type="number"
                      className="input input-bordered input-sm w-full"
                      value={column.width || ''}
                      onChange={(e) => updateColumn(column.id, { width: e.target.value ? parseInt(e.target.value) : undefined })}
                      placeholder="Auto"
                      min="50"
                    />
                  </div>
                  <div className="col-span-2 flex items-center gap-2">
                    <label className="label cursor-pointer">
                      <span className="label-text text-xs">Required</span>
                      <input
                        type="checkbox"
                        className="checkbox checkbox-sm"
                        checked={column.required || false}
                        onChange={(e) => updateColumn(column.id, { required: e.target.checked })}
                      />
                    </label>
                  </div>
                  <div className="col-span-1">
                    {columns.length > 1 && (
                      <button
                        type="button"
                        className="btn btn-sm btn-error"
                        onClick={() => removeColumn(column.id)}
                      >
                        ×
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex gap-2 justify-end">
          <Link href="/tables" className="btn btn-outline">
            Cancel
          </Link>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Creating...' : 'Create Table'}
          </button>
        </div>
      </form>
    </div>
  );
}

