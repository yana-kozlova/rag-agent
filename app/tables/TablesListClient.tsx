'use client';

import { useEffect, useState } from 'react';
import { deleteUserTable } from '@/lib/actions/user-tables';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export type UserTable = {
  id: string;
  title: string;
  description?: string | null;
  columns: any[];
  settings?: any;
  createdAt: string | Date;
  updatedAt: string | Date;
};

export default function TablesListClient({ initialTables }: { initialTables: UserTable[] }) {
  const router = useRouter();
  const [tables, setTables] = useState<UserTable[]>(initialTables);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this table?')) return;
    
    const result = await deleteUserTable(id);
    if (result.success) {
      setTables(prev => prev.filter(t => t.id !== id));
      setToast({ message: 'Table deleted successfully', type: 'success' });
    } else {
      setToast({ message: result.message || 'Failed to delete table', type: 'error' });
    }
  };

  const formatDate = (date: string | Date) => {
    const d = new Date(date);
    return d.toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-6">
      {toast && (
        <div className={`alert ${toast.type === 'success' ? 'alert-success' : 'alert-error'} shadow-lg fixed top-4 right-4 z-50 max-w-md`}>
          <span>{toast.message}</span>
          <button className="btn btn-sm btn-ghost" onClick={() => setToast(null)}>×</button>
        </div>
      )}
      
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">My Tables</h1>
        <div className="flex gap-2">
          <Link href="/tables/new" className="btn btn-primary btn-sm">
            Create New Table
          </Link>
        </div>
      </div>

      {tables.length === 0 ? (
        <div className="text-center py-8 text-base-content/70">
          <p className="mb-4">No tables yet. Create your first table to get started!</p>
          <Link href="/tables/new" className="btn btn-primary">
            Create New Table
          </Link>
        </div>
      ) : (
        <div className="grid gap-4">
          {tables.map((table) => (
            <div key={table.id} className="rounded-lg border border-base-300 bg-base-100">
              <div className="p-4 md:p-5">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h2 className="text-base font-semibold mb-2">{table.title}</h2>
                    {table.description && (
                      <p className="text-sm text-base-content/70 mb-2">{table.description}</p>
                    )}
                    <div className="flex gap-4 text-sm text-base-content/60 mb-2">
                      <span>{table.columns.length} columns</span>
                      <span>View rows</span>
                    </div>
                    <p className="text-sm text-base-content/70">
                      Updated: {formatDate(table.updatedAt)}
                    </p>
                  </div>
                </div>
                <div className="flex justify-end gap-2 mt-4">
                  <button
                    className="btn btn-sm btn-outline"
                    onClick={() => router.push(`/tables/${table.id}`)}
                  >
                    View/Edit
                  </button>
                  <button
                    className="btn btn-sm btn-error"
                    onClick={() => handleDelete(table.id)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

