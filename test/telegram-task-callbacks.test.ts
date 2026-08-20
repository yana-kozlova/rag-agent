/**
 * The task button namespace, against the three that already exist.
 *
 * The parsers must be mutually exclusive by test, not by convention: a
 * notification's "save" read as a task press would close a task the user never
 * touched, and a task press read as a quick action would write a table row.
 */
import { describe, it, expect } from 'vitest';

import {
  encodeCallbackData,
  encodeQuickActionCallback,
  encodeQuickUndoCallback,
  encodeTaskCallback,
  parseCallbackData,
  parseQuickActionCallback,
  parseQuickUndoCallback,
  parseTaskCallback,
} from '@/lib/telegram/callback-data';

const ID = 'abcdefghijklmnopqrstu'; // a 21-character nanoid

describe('encodeTaskCallback / parseTaskCallback', () => {
  it('round-trips both actions', () => {
    expect(parseTaskCallback(encodeTaskCallback('done', ID))).toEqual({
      action: 'done',
      taskId: ID,
    });
    expect(parseTaskCallback(encodeTaskCallback('tomorrow', ID))).toEqual({
      action: 'tomorrow',
      taskId: ID,
    });
  });

  it('fits inside Telegram\'s 64-byte callback_data budget', () => {
    for (const action of ['done', 'tomorrow'] as const) {
      const data = encodeTaskCallback(action, ID);
      expect(Buffer.byteLength(data, 'utf8')).toBeLessThanOrEqual(64);
    }
  });

  it('refuses junk, an empty id and an unknown verb', () => {
    expect(parseTaskCallback(undefined)).toBeNull();
    expect(parseTaskCallback('')).toBeNull();
    expect(parseTaskCallback('t:')).toBeNull();
    expect(parseTaskCallback('t:d:')).toBeNull();
    expect(parseTaskCallback('t:x:abc')).toBeNull();
    expect(parseTaskCallback('nonsense')).toBeNull();
  });
});

describe('the four namespaces never read each other', () => {
  const samples = {
    notification: encodeCallbackData('save'),
    notificationSnooze: encodeCallbackData('snooze', 60),
    quick: encodeQuickActionCallback(ID),
    quickUndo: encodeQuickUndoCallback(ID, ID),
    task: encodeTaskCallback('done', ID),
  };

  it('a task press is not a notification, a quick action or an undo', () => {
    expect(parseCallbackData(samples.task)).toBeNull();
    expect(parseQuickActionCallback(samples.task)).toBeNull();
    expect(parseQuickUndoCallback(samples.task)).toBeNull();
    expect(parseTaskCallback(samples.task)).not.toBeNull();
  });

  it('a notification press is never read as a task', () => {
    expect(parseTaskCallback(samples.notification)).toBeNull();
    expect(parseTaskCallback(samples.notificationSnooze)).toBeNull();
  });

  it('a quick action press is never read as a task', () => {
    expect(parseTaskCallback(samples.quick)).toBeNull();
    expect(parseTaskCallback(samples.quickUndo)).toBeNull();
  });

  it('every sample is claimed by exactly one parser', () => {
    for (const [name, data] of Object.entries(samples)) {
      const claims = [
        parseCallbackData(data),
        parseQuickActionCallback(data),
        parseQuickUndoCallback(data),
        parseTaskCallback(data),
      ].filter((r) => r !== null);

      expect(claims, `${name} was claimed ${claims.length} times`).toHaveLength(1);
    }
  });
});
