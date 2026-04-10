'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { updateUserTable } from '@/lib/actions/user-tables';
import Link from 'next/link';
import type { TableColumn, TableRow } from '@/lib/db/schema/user-tables';

type TableRowWithId = TableRow & { _id?: string };

export type UserTable = {
  id: string;
  title: string;
  description?: string | null;
  columns: TableColumn[];
  data: TableRowWithId[];
  settings?: any;
};

export default function EditTableClient({
  tableId,
  initialTable,
}: {
  tableId: string;
  initialTable: UserTable;
}) {
  const router = useRouter();
  const [table, setTable] = useState<UserTable | null>(initialTable);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingRow, setEditingRow] = useState<number | null>(null);
  const [newRow, setNewRow] = useState<TableRow>({});
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Auto-hide toast after 3 seconds
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const loadTable = useCallback(async () => {
    try {
      setLoading(true);
      // Load table metadata and rows in parallel
      const [tableRes, dataRes] = await Promise.all([
        fetch(`/api/user-tables/${tableId}`),
        fetch(`/api/user-tables/${tableId}/data`),
      ]);
      const [tableData, dataData] = await Promise.all([
        tableRes.json(),
        dataRes.json(),
      ]);

      if (!tableData.ok) {
        setToast({ message: 'Table not found', type: 'error' });
        setTimeout(() => router.push('/tables'), 1500);
        return;
      }

      if (tableData.ok && dataData.ok) {
        // Map rows with their IDs from the API response
        const rowsWithIds = (dataData.rows || []).map((row: any, index: number) => {
          if (!row || typeof row !== 'object') {
            return { _id: `temp-${index}` };
          }
          return {
            ...row,
            _id: row._id || `temp-${index}`, // Use _id if available, otherwise temp ID
          };
        });
        setTable({
          ...tableData.table,
          data: rowsWithIds,
        });
      }
    } catch (error) {
      setToast({ message: 'Failed to load table', type: 'error' });
    } finally {
      setLoading(false);
    }
  }, [tableId, router]);

  const handleSave = async () => {
    if (!table) return;

    setSaving(true);
    try {
      // Save table metadata (columns, settings, etc.)
      const result = await updateUserTable(tableId, {
        title: table.title,
        description: table.description,
        columns: table.columns,
        settings: table.settings,
      });

      if (result.success) {
        setToast({ message: 'Table saved successfully', type: 'success' });
        setEditingRow(null);
        setNewRow({});
      } else {
        setToast({ message: result.message || 'Failed to save table', type: 'error' });
      }
    } catch (error) {
      setToast({ message: 'Failed to save table', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleAddRow = async () => {
    if (!table) return;
    
    // Validate required fields
    for (const col of table.columns) {
      if (col.required && !newRow[col.id]) {
        setToast({ message: `Please fill in required field: ${col.name}`, type: 'error' });
        return;
      }
    }

    try {
      const res = await fetch(`/api/user-tables/${tableId}/data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rowData: newRow }),
      });
      const data = await res.json();

      if (data.ok) {
        setTable({
          ...table,
          data: [...table.data, { ...newRow, _id: data.id }],
        });
        setNewRow({});
        setToast({ message: 'Row added successfully', type: 'success' });
      } else {
        setToast({ message: data.error || 'Failed to add row', type: 'error' });
      }
    } catch (error) {
      setToast({ message: 'Failed to add row', type: 'error' });
    }
  };

  const handleUpdateRow = async (rowId: string, field: string, value: any) => {
    if (!table) return;
    
    // Find row by ID
    const rowIndex = table.data.findIndex((row) => (row as any)._id === rowId);
    if (rowIndex === -1) return;
    
    const updated = [...table.data];
    updated[rowIndex] = { ...updated[rowIndex], [field]: value };
    setTable({ ...table, data: updated });

    // Save to server
    try {
      const row = { ...updated[rowIndex] };
      const { _id, ...rowData } = row; // Remove _id before sending
      const res = await fetch(`/api/user-tables/${tableId}/data/${rowId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rowData }),
      });
      const data = await res.json();

      if (!data.ok) {
        setToast({ message: data.error || 'Failed to update row', type: 'error' });
        // Reload on error
        loadTable();
      } else {
        setToast({ message: 'Row updated successfully', type: 'success' });
      }
    } catch (error) {
      setToast({ message: 'Failed to update row', type: 'error' });
      loadTable();
    }
  };

  const handleDeleteRow = async (rowId: string, index: number) => {
    if (!table) return;
    if (!confirm('Are you sure you want to delete this row?')) return;
    
    try {
      const res = await fetch(`/api/user-tables/${tableId}/data/${rowId}`, {
        method: 'DELETE',
      });
      const data = await res.json();

      if (data.ok) {
        setTable({
          ...table,
          data: table.data.filter((_, i) => i !== index),
        });
        setToast({ message: 'Row deleted successfully', type: 'success' });
      } else {
        setToast({ message: data.error || 'Failed to delete row', type: 'error' });
      }
    } catch (error) {
      setToast({ message: 'Failed to delete row', type: 'error' });
    }
  };

  if (loading) {
    return (
      <div className="container mx-auto p-4 md:p-6">
        <div className="text-center py-8">Loading table...</div>
      </div>
    );
  }

  if (!table) {
    return null;
  }

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-6">
      {/* Toast notification */}
      {toast && (
        <div className={`alert ${toast.type === 'success' ? 'alert-success' : 'alert-error'} shadow-lg fixed top-4 right-4 z-50 max-w-md`}>
          <span>{toast.message}</span>
          <button className="btn btn-sm btn-ghost" onClick={() => setToast(null)}>×</button>
        </div>
      )}
      
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{table.title}</h1>
          {table.description && (
            <p className="text-base-content/70 mt-1">{table.description}</p>
          )}
        </div>
        <div className="flex gap-2">
          <button
            className="btn btn-primary btn-sm"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
          <Link href="/tables" className="btn btn-outline btn-sm">
            Back to Tables
          </Link>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="table table-zebra w-full">
          <thead>
            <tr>
              {table.columns.map((col) => (
                <th key={col.id} style={{ width: col.width ? `${col.width}px` : 'auto' }}>
                  {col.name}
                  {col.required && <span className="text-error ml-1">*</span>}
                  <div className="text-xs text-base-content/60">{col.type}</div>
                </th>
              ))}
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {table.data.map((row, rowIndex) => {
              const rowId = (row as any)._id || `row-${rowIndex}`;
              return (
                <tr key={rowId}>
                  {table.columns.map((col) => (
                    <td key={col.id}>
                      {editingRow === rowIndex ? (
                        <input
                          type={col.type === 'number' ? 'number' : col.type === 'date' ? 'date' : 'text'}
                          className="input input-bordered input-sm w-full"
                          value={row[col.id] || ''}
                          onChange={(e) => handleUpdateRow(rowId, col.id, e.target.value)}
                        />
                      ) : (
                        <span>{row[col.id] || '-'}</span>
                      )}
                    </td>
                  ))}
                  <td>
                    <div className="flex gap-1">
                      {editingRow === rowIndex ? (
                        <button
                          className="btn btn-xs btn-success"
                          onClick={() => setEditingRow(null)}
                        >
                          ✓
                        </button>
                      ) : (
                        <button
                          className="btn btn-xs btn-outline"
                          onClick={() => setEditingRow(rowIndex)}
                        >
                          Edit
                        </button>
                      )}
                      <button
                        className="btn btn-xs btn-error"
                        onClick={() => handleDeleteRow(rowId, rowIndex)}
                      >
                        ×
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {/* New row form */}
            <tr className="bg-base-200">
              {table.columns.map((col) => (
                <td key={col.id}>
                  <input
                    type={col.type === 'number' ? 'number' : col.type === 'date' ? 'date' : 'text'}
                    className="input input-bordered input-sm w-full"
                    placeholder={col.name}
                    value={newRow[col.id] || ''}
                    onChange={(e) => setNewRow({ ...newRow, [col.id]: e.target.value })}
                    required={col.required}
                  />
                </td>
              ))}
              <td>
                <button
                  className="btn btn-xs btn-primary"
                  onClick={handleAddRow}
                >
                  Add
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

    </div>
  );
}

