'use server';

import { auth } from '@/app/api/auth/auth';
import { db } from '@/lib/db';
import { 
  userTables, 
  userTablesData,
  createUserTableSchema, 
  updateUserTableSchema,
  createTableRowSchema,
  updateTableRowSchema,
  type CreateUserTableParams, 
  type UpdateUserTableParams,
  type CreateTableRowParams,
  type UpdateTableRowParams,
} from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export const createUserTable = async (input: CreateUserTableParams) => {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return { success: false, message: 'Unauthorized. Please sign in.' };
    }

    const parsed = createUserTableSchema.parse(input);
    const [table] = await db
      .insert(userTables)
      .values({
        ...parsed,
        userId: userId as any,
        settings: parsed.settings || { sortable: true, filterable: true, editable: true },
      })
      .returning();

    return { success: true, message: 'Table successfully created.', id: table.id };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error && error.message.length > 0
        ? error.message
        : 'Error creating table, please try again.'
    };
  }
};

export const updateUserTable = async (id: string, input: UpdateUserTableParams) => {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return { success: false, message: 'Unauthorized. Please sign in.' };
    }

    // Verify ownership
    const [existing] = await db
      .select()
      .from(userTables)
      .where(eq(userTables.id, id));

    if (!existing) {
      return { success: false, message: 'Table not found.' };
    }

    if (existing.userId !== userId) {
      return { success: false, message: 'Unauthorized. You can only update your own tables.' };
    }

    const parsed = updateUserTableSchema.parse(input);
    
    const [updated] = await db
      .update(userTables)
      .set({
        ...parsed,
        updatedAt: new Date(),
      })
      .where(eq(userTables.id, id))
      .returning();

    return { success: true, message: 'Table successfully updated.', table: updated };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error && error.message.length > 0
        ? error.message
        : 'Error updating table, please try again.'
    };
  }
};

export const deleteUserTable = async (id: string) => {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return { success: false, message: 'Unauthorized. Please sign in.' };
    }

    // Verify ownership
    const [existing] = await db
      .select()
      .from(userTables)
      .where(eq(userTables.id, id));

    if (!existing) {
      return { success: false, message: 'Table not found.' };
    }

    if (existing.userId !== userId) {
      return { success: false, message: 'Unauthorized. You can only delete your own tables.' };
    }

    await db
      .delete(userTables)
      .where(eq(userTables.id, id));

    return { success: true, message: 'Table successfully deleted.' };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error && error.message.length > 0
        ? error.message
        : 'Error deleting table, please try again.'
    };
  }
};

// Table row operations
export const createTableRow = async (input: CreateTableRowParams) => {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return { success: false, message: 'Unauthorized. Please sign in.' };
    }

    // Verify table belongs to user
    const [table] = await db
      .select()
      .from(userTables)
      .where(eq(userTables.id, input.userTableId))
      .limit(1);

    if (!table) {
      return { success: false, message: 'Table not found.' };
    }

    if (table.userId !== userId) {
      return { success: false, message: 'Unauthorized. You can only add rows to your own tables.' };
    }

    const parsed = createTableRowSchema.parse(input);
    const [row] = await db
      .insert(userTablesData)
      .values({
        userTableId: parsed.userTableId,
        rowData: parsed.rowData,
        metadata: parsed.metadata || null,
      })
      .returning();

    return { success: true, message: 'Row successfully created.', id: row.id };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error && error.message.length > 0
        ? error.message
        : 'Error creating row, please try again.'
    };
  }
};

export const updateTableRow = async (rowId: string, input: UpdateTableRowParams) => {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return { success: false, message: 'Unauthorized. Please sign in.' };
    }

    // Verify row belongs to user's table
    const [row] = await db
      .select({
        row: userTablesData,
        table: userTables,
      })
      .from(userTablesData)
      .innerJoin(userTables, eq(userTablesData.userTableId, userTables.id))
      .where(eq(userTablesData.id, rowId))
      .limit(1);

    if (!row) {
      return { success: false, message: 'Row not found.' };
    }

    if (row.table.userId !== userId) {
      return { success: false, message: 'Unauthorized. You can only update rows in your own tables.' };
    }

    const parsed = updateTableRowSchema.parse(input);
    
    const [updated] = await db
      .update(userTablesData)
      .set({
        ...parsed,
        updatedAt: new Date(),
      })
      .where(eq(userTablesData.id, rowId))
      .returning();

    return { success: true, message: 'Row successfully updated.', row: updated };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error && error.message.length > 0
        ? error.message
        : 'Error updating row, please try again.'
    };
  }
};

export const deleteTableRow = async (rowId: string) => {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return { success: false, message: 'Unauthorized. Please sign in.' };
    }

    // Verify row belongs to user's table
    const [row] = await db
      .select({
        row: userTablesData,
        table: userTables,
      })
      .from(userTablesData)
      .innerJoin(userTables, eq(userTablesData.userTableId, userTables.id))
      .where(eq(userTablesData.id, rowId))
      .limit(1);

    if (!row) {
      return { success: false, message: 'Row not found.' };
    }

    if (row.table.userId !== userId) {
      return { success: false, message: 'Unauthorized. You can only delete rows from your own tables.' };
    }

    await db
      .delete(userTablesData)
      .where(eq(userTablesData.id, rowId));

    return { success: true, message: 'Row successfully deleted.' };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error && error.message.length > 0
        ? error.message
        : 'Error deleting row, please try again.'
    };
  }
};

