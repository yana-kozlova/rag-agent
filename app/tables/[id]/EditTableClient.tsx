'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { updateUserTable } from '@/lib/actions/user-tables';
import Link from 'next/link';
import QuickActionsBar from '@/app/components/quick-actions/QuickActionsBar';
import { RoutineOffer } from '@/app/components/quick-actions/RoutineOffer';
import { EditableCell } from '@/app/components/tables/EditableCell';
import type { RepeatingRow } from '@/lib/quick-actions/detect';
import { coerceValue } from '@/lib/utils/table-columns';
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

/** Which cell is open. Keyed on the row's id, never its index: a row deleted
 *  or a reload arriving underneath renumbers the list, and an index-keyed edit
 *  quietly follows to whatever row moved into that slot. */
type CellRef = { rowId: string; columnId: string };

/**
 * Two values are the same cell.
 *
 * Empty is empty however it is spelled — a cleared input gives `null`, an
 * untouched one may hold `''` or nothing at all, and none of those are worth a
 * write. That matters more than tidiness here: `updateTableRow` deletes the
 * row's embeddings and pays OpenAI for new ones on every call, so clicking into
 * a cell to read it and clicking out again would otherwise cost a request each
 * time.
 */
function sameCellValue(a: unknown, b: unknown): boolean {
  const emptyA = a === null || a === undefined || a === '';
  const emptyB = b === null || b === undefined || b === '';
  if (emptyA || emptyB) return emptyA && emptyB;
  return a === b;
}

export default function EditTableClient({
  tableId,
  initialTable,
  routine = null,
}: {
  tableId: string;
  initialTable: UserTable;
  /** A repeating row this table shows, when no button covers it yet. */
  routine?: RepeatingRow | null;
}) {
  const router = useRouter();
  const [table, setTable] = useState<UserTable | null>(initialTable);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingCell, setEditingCell] = useState<CellRef | null>(null);
  const [savingCells, setSavingCells] = useState<Set<string>>(new Set());
  const [newRow, setNewRow] = useState<TableRow>({});
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Each cell writes the *whole* row, because that is the only shape the PATCH
  // takes. Two of them in flight at once is therefore last-write-wins over
  // everything, not just over the cell in question — tab from one cell to the
  // next, and if the first request is the slower of the two it lands second and
  // puts the second cell back the way it was. The row's embeddings are
  // regenerated on every one of those calls, so the slower request is not the
  // unlikely one.
  //
  // So writes are queued per row, and each one is built from the row as it will
  // be once everything ahead of it has landed rather than from what is on
  // screen — React has not necessarily re-rendered yet when the next commit is
  // made, and a value read a render too early is the same bug wearing the
  // optimistic update as a disguise.
  const pendingRows = useRef<Map<string, TableRowWithId>>(new Map());
  const writeQueue = useRef<Map<string, Promise<unknown>>>(new Map());

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
      // Load table metadata and rows in parallel. The limit matches what the
      // server component renders on first paint — at the default 100 a reload
      // after a quick-action press silently truncated a longer table, and the
      // rows that vanished were the oldest, which is where a routine's evidence
      // lives.
      const [tableRes, dataRes] = await Promise.all([
        fetch(`/api/user-tables/${tableId}`),
        fetch(`/api/user-tables/${tableId}/data?limit=500`),
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

    // Read into the column's type on the way in, exactly as a cell edit and a
    // quick-action press do. Everything arrives from an input box as text, and
    // a number column filled from this form used to keep the string.
    const rowData = Object.fromEntries(
      table.columns
        .map((col) => [col.id, coerceValue(newRow[col.id], col.type)] as const)
        .filter(([, value]) => value !== null)
    );

    try {
      const res = await fetch(`/api/user-tables/${tableId}/data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rowData }),
      });
      const data = await res.json();

      if (data.ok) {
        setTable({
          ...table,
          data: [...table.data, { ...rowData, _id: data.id }],
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

  /** Open the cell beside the one just written, or close if the row ends. */
  const moveTo = (rowId: string, columnId: string, direction: 'next' | 'prev') => {
    if (!table) return;
    const index = table.columns.findIndex((c) => c.id === columnId);
    const target = table.columns[direction === 'next' ? index + 1 : index - 1];
    setEditingCell(target ? { rowId, columnId: target.id } : null);
  };

  /**
   * Write one cell.
   *
   * Optimistic, because the value the user typed is the one they expect to see
   * and a round-trip through OpenAI's embedding endpoint is not a wait worth
   * making them watch. A failure puts the old value back rather than reloading
   * the table: reloading leaves the wrong value on screen until it lands, and
   * a reload is exactly what loses the other cells someone is mid-way through.
   *
   * Success is silent on purpose. A toast per cell turns editing a row into
   * four notifications about work the user watched happen; the value staying
   * where they put it is the confirmation, and only a failure is news.
   */
  const commitCell = (rowId: string, columnId: string, next: unknown, move?: 'next' | 'prev') => {
    if (!table) return;

    if (move) moveTo(rowId, columnId, move);
    else setEditingCell(null);

    const rowIndex = table.data.findIndex((row) => (row as any)._id === rowId);
    if (rowIndex === -1) return;

    // What the row will be once the writes already queued for it have landed,
    // which is what this edit is actually a change to.
    const base = pendingRows.current.get(rowId) ?? table.data[rowIndex];
    const previous = base[columnId];
    if (sameCellValue(previous, next)) return;

    const nextRow: TableRowWithId = { ...base, [columnId]: next };
    pendingRows.current.set(rowId, nextRow);

    const apply = (value: unknown) =>
      setTable((current) => {
        if (!current) return current;
        const index = current.data.findIndex((row) => (row as any)._id === rowId);
        if (index === -1) return current;
        const rows = [...current.data];
        rows[index] = { ...rows[index], [columnId]: value };
        return { ...current, data: rows };
      });

    apply(next);

    const key = `${rowId}:${columnId}`;
    setSavingCells((prev) => new Set(prev).add(key));

    const rollback = () => {
      apply(previous);
      const pending = pendingRows.current.get(rowId);
      if (pending) pendingRows.current.set(rowId, { ...pending, [columnId]: previous });
    };

    const write = async () => {
      try {
        const { _id, ...rowData } = pendingRows.current.get(rowId) ?? nextRow;
        const res = await fetch(`/api/user-tables/${tableId}/data/${rowId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rowData }),
        });
        const data = await res.json();

        if (!data.ok) {
          setToast({ message: data.error || 'Failed to update row', type: 'error' });
          rollback();
        }
      } catch (error) {
        setToast({ message: 'Failed to update row', type: 'error' });
        rollback();
      } finally {
        setSavingCells((prev) => {
          const rest = new Set(prev);
          rest.delete(key);
          return rest;
        });
      }
    };

    const queued = (writeQueue.current.get(rowId) ?? Promise.resolve()).then(write);
    writeQueue.current.set(rowId, queued);
    // Once nothing else is waiting behind it, the row on screen is the row on
    // the server again and the pending copy is only something to go stale.
    queued.finally(() => {
      if (writeQueue.current.get(rowId) !== queued) return;
      writeQueue.current.delete(rowId);
      pendingRows.current.delete(rowId);
    });
  };

  const handleDeleteRow = async (rowId: string) => {
    if (!table) return;
    if (!confirm('Are you sure you want to delete this row?')) return;
    
    try {
      const res = await fetch(`/api/user-tables/${tableId}/data/${rowId}`, {
        method: 'DELETE',
      });
      const data = await res.json();

      if (data.ok) {
        pendingRows.current.delete(rowId);
        writeQueue.current.delete(rowId);
        setTable({
          ...table,
          data: table.data.filter((row) => (row as any)._id !== rowId),
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

      {/* Manageable here and nowhere else: this is the page you come to when a
          button is wrong, and a delete control beside one you press daily on
          the dashboard is a mis-tap waiting to happen. */}
      {routine && (
        <RoutineOffer
          tableId={tableId}
          label={routine.label}
          values={routine.values}
          occurrences={routine.occurrences}
          days={routine.days}
          fields={routine.fields}
        />
      )}

      <QuickActionsBar tableId={tableId} manage onWrote={loadTable} emptyHint={false} />

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
                    <td key={col.id} className="align-top">
                      <EditableCell
                        column={col}
                        value={row[col.id]}
                        editing={
                          editingCell?.rowId === rowId && editingCell?.columnId === col.id
                        }
                        saving={savingCells.has(`${rowId}:${col.id}`)}
                        onOpen={() => setEditingCell({ rowId, columnId: col.id })}
                        onCommit={(next, move) => commitCell(rowId, col.id, next, move)}
                        onCancel={() => setEditingCell(null)}
                      />
                    </td>
                  ))}
                  <td>
                    <button
                      className="btn btn-xs btn-error"
                      onClick={() => handleDeleteRow(rowId)}
                      aria-label="Delete row"
                    >
                      ×
                    </button>
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
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddRow();
                      }
                    }}
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
