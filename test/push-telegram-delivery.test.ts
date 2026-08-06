import { describe, it, expect } from 'vitest';
import {
  buildKeyboard,
  renderNotification,
  splitNotification,
} from '@/lib/push/deliver';
import {
  encodeCallbackData,
  parseCallbackData,
  MAX_SNOOZE_MINUTES,
} from '@/lib/telegram/callback-data';
import { DEFAULT_SNOOZE_MINUTES } from '@/lib/push/utils';

describe('rendering a notification for Telegram', () => {
  it('separates title from body with a blank line', () => {
    expect(renderNotification({ title: '☀️ 3 things today', body: '09:00 Standup' })).toBe(
      '☀️ 3 things today\n\n09:00 Standup'
    );
  });

  it('sends the title alone when there is no body', () => {
    expect(renderNotification({ title: '☀️ Good morning', body: '' })).toBe(
      '☀️ Good morning'
    );
  });

  /**
   * The snooze handler rebuilds a notification from the message text Telegram
   * gives back, so the two halves have to survive the round trip — including a
   * body that contains blank lines of its own.
   */
  it('round-trips through the message text', () => {
    const payload = { title: '⚠️ Double-booked', body: 'first para\n\nsecond para' };
    expect(splitNotification(renderNotification(payload))).toEqual(payload);
  });

  it('reads a message with no blank line as all title', () => {
    expect(splitNotification('⏰ Reminder')).toEqual({ title: '⏰ Reminder', body: '' });
  });
});

describe('notification buttons', () => {
  it('offers no keyboard when there is nothing to act on', () => {
    expect(buildKeyboard({ title: 't', body: 'b' })).toBeUndefined();
    expect(buildKeyboard({ title: 't', body: 'b', actions: [] })).toBeUndefined();
  });

  it('carries the payload snooze delay into the button', () => {
    const keyboard = buildKeyboard({
      title: 't',
      body: 'b',
      actions: ['snooze', 'save'],
      snoozeMinutes: 60,
    });

    expect(keyboard?.inline_keyboard[0].map((b) => b.callback_data)).toEqual([
      'n:snooze:60',
      'n:save',
    ]);
  });

  it('falls back to the default delay when the payload names none', () => {
    const keyboard = buildKeyboard({ title: 't', body: 'b', actions: ['snooze'] });

    expect(keyboard?.inline_keyboard[0][0].callback_data).toBe(
      `n:snooze:${DEFAULT_SNOOZE_MINUTES}`
    );
  });

  /** Telegram caps callback_data at 64 bytes and drops the button otherwise. */
  it('stays inside the callback_data budget', () => {
    for (const action of ['snooze', 'save', 'dismiss'] as const) {
      const encoded = encodeCallbackData(action, MAX_SNOOZE_MINUTES);
      expect(Buffer.byteLength(encoded, 'utf8')).toBeLessThanOrEqual(64);
    }
  });
});

describe('reading a button press back', () => {
  it('parses what it encodes', () => {
    expect(parseCallbackData(encodeCallbackData('snooze', 30))).toEqual({
      action: 'snooze',
      minutes: 30,
    });
    expect(parseCallbackData(encodeCallbackData('save'))?.action).toBe('save');
    expect(parseCallbackData(encodeCallbackData('dismiss'))?.action).toBe('dismiss');
  });

  it('rejects anything outside its namespace', () => {
    expect(parseCallbackData('snooze:30')).toBeNull();
    expect(parseCallbackData('x:snooze:30')).toBeNull();
    expect(parseCallbackData('n:detonate')).toBeNull();
    expect(parseCallbackData(undefined)).toBeNull();
    expect(parseCallbackData('')).toBeNull();
  });

  it('clamps a hand-crafted snooze rather than honouring it', () => {
    expect(parseCallbackData('n:snooze:999999')?.minutes).toBe(MAX_SNOOZE_MINUTES);
    expect(parseCallbackData('n:snooze:0')?.minutes).toBe(1);
    expect(parseCallbackData('n:snooze:-5')?.minutes).toBe(1);
    expect(parseCallbackData('n:snooze:abc')?.minutes).toBe(DEFAULT_SNOOZE_MINUTES);
  });
});
