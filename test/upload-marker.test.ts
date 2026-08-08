import { describe, expect, it } from 'vitest';
import { convertToModelMessages } from 'ai';

import {
  readUploadMarker,
  stripUploadMarker,
  uploadInstruction,
  uploadMarker,
  withText,
} from '@/lib/chat/upload-marker';

/**
 * The marker is a contract between two files that never met in a test.
 *
 * `ChatSection` builds it, `/api/chat` reads it, and the route then wrote the
 * result to `message.content` — which `convertToModelMessages` ignores. Every
 * unit here would have passed under that bug except the last block, which is the
 * only one that asks the question that matters: what does the model actually
 * receive?
 */
describe('upload marker', () => {
  it('round-trips the ids the chat attached', () => {
    const text = `Що тут написано?${uploadMarker(['abc123', 'def456'])}`;

    expect(readUploadMarker(text)).toEqual(['abc123', 'def456']);
    expect(stripUploadMarker(text)).toBe('Що тут написано?');
  });

  it('is invisible — the marker adds no printable characters', () => {
    const marker = uploadMarker(['abc123']);
    expect(marker.replace(/​/g, '')).toBe('[RESOURCE_IDS:abc123]');
  });

  it('reports nothing for an ordinary message', () => {
    expect(readUploadMarker('просто питання')).toBeNull();
    expect(readUploadMarker('')).toBeNull();
  });

  it('treats an empty id list as no marker rather than as one file named ""', () => {
    expect(readUploadMarker('​​[RESOURCE_IDS:]​​')).toBeNull();
  });
});

describe('withText', () => {
  it('rewrites the first text part, which is the one the text was read from', () => {
    const message = { role: 'user', parts: [{ type: 'text', text: 'old' }] };

    expect(withText(message, 'new')).toMatchObject({
      parts: [{ type: 'text', text: 'new' }],
      content: 'new',
    });
  });

  it('leaves non-text parts alone', () => {
    const message = {
      role: 'user',
      parts: [
        { type: 'file', mediaType: 'image/png', url: 'blob:x' },
        { type: 'text', text: 'old' },
      ],
    };

    expect(withText(message, 'new').parts).toEqual([
      { type: 'file', mediaType: 'image/png', url: 'blob:x' },
      { type: 'text', text: 'new' },
    ]);
  });

  it('adds a text part to a message that had none', () => {
    const message = { role: 'user', parts: [{ type: 'file', mediaType: 'image/png', url: 'b' }] };

    expect(withText(message, 'new').parts).toHaveLength(2);
    expect(withText(message, 'new').parts?.[1]).toEqual({ type: 'text', text: 'new' });
  });
});

describe('what the model actually receives', () => {
  /** Exactly the shape `useChat`'s `sendMessage({ text })` produces. */
  function uiMessage(text: string) {
    return { id: 'm1', role: 'user' as const, parts: [{ type: 'text' as const, text }] };
  }

  /** The route's transform, in one line, as it now stands. */
  function processed(text: string) {
    const ids = readUploadMarker(text);
    if (!ids) return uiMessage(text);
    const said = stripUploadMarker(text);
    const info = uploadInstruction(ids);
    return withText(uiMessage(text), said ? `${said}\n\n${info}` : info);
  }

  it('carries the instruction into the model messages', () => {
    const sent = `Що тут написано?${uploadMarker(['abc123', 'def456'])}`;
    const serialized = JSON.stringify(convertToModelMessages([processed(sent)] as any));

    // The regression: this was false, because the instruction only ever reached
    // `content` and `convertToModelMessages` reads `parts`.
    expect(serialized).toContain('[FILES_UPLOADED]');
    expect(serialized).toContain('abc123');
    expect(serialized).toContain('def456');
    expect(serialized).toContain('Що тут написано?');
  });

  it('never leaks the raw marker to the model', () => {
    const sent = `Що тут написано?${uploadMarker(['abc123'])}`;
    const serialized = JSON.stringify(convertToModelMessages([processed(sent)] as any));

    expect(serialized).not.toContain('RESOURCE_IDS');
    expect(serialized).not.toContain('​');
  });

  it('leaves a message with no files exactly as it was', () => {
    const serialized = JSON.stringify(convertToModelMessages([processed('що в мене завтра?')] as any));

    expect(serialized).toContain('що в мене завтра?');
    expect(serialized).not.toContain('FILES_UPLOADED');
  });
});
