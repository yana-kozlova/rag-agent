import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The module under test reaches the Bot API, the blob store and a vision model,
// none of which a routing test should touch. Env is read at import time.
vi.mock('@/lib/env.mjs', () => ({ env: {} }));

const downloadFile = vi.hoisted(() => vi.fn());
vi.mock('@/lib/telegram/api', () => ({ downloadFile }));

const saveImageResource = vi.hoisted(() => vi.fn());
vi.mock('@/lib/actions/save-image', () => ({ saveImageResource }));

const createResource = vi.hoisted(() => vi.fn());
vi.mock('@/lib/actions/resources', () => ({ createResource }));

const extractTextFromFile = vi.hoisted(() => vi.fn());
vi.mock('@/lib/utils/file-extraction', async () => {
  // `isImageFile` and the extension helpers are pure and worth exercising for
  // real — the point of these tests is which branch a file takes.
  const actual = await vi.importActual<typeof import('@/lib/utils/file-extraction')>(
    '@/lib/utils/file-extraction'
  );
  return { ...actual, extractTextFromFile };
});

import { ingestDocument, ingestPhoto, largestPhoto } from '@/lib/telegram/media';

const USER_ID = '00000000-0000-0000-0000-000000000001';
const BYTES = Buffer.from('pretend jpeg');

beforeEach(() => {
  downloadFile.mockResolvedValue(BYTES);
  saveImageResource.mockResolvedValue({
    ok: true,
    resourceId: 'res_1',
    description: 'Рецепт сирників: сир, яйце, борошно.',
    imageUrl: 'https://store.public.blob.vercel-storage.com/a.jpg',
  });
  createResource.mockResolvedValue({ success: true, id: 'res_2' });
  extractTextFromFile.mockResolvedValue({ success: true, text: 'текст із документа' });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('largestPhoto', () => {
  it('picks the biggest by area, not by position', () => {
    // Deliberately out of order: the API convention is smallest-first, but the
    // payload does not guarantee it, and a thumbnail is where OCR fails.
    const best = largestPhoto([
      { file_id: 'big', width: 1280, height: 960 },
      { file_id: 'small', width: 90, height: 67 },
    ]);
    expect(best?.file_id).toBe('big');
  });

  it('returns null when there are no sizes at all', () => {
    expect(largestPhoto(undefined)).toBeNull();
    expect(largestPhoto([])).toBeNull();
  });
});

describe('ingestPhoto', () => {
  it('saves the largest size as an image resource', async () => {
    const result = await ingestPhoto({
      sizes: [
        { file_id: 'small', width: 90, height: 67 },
        { file_id: 'big', width: 1280, height: 960 },
      ],
      caption: 'сирники',
      userId: USER_ID,
    });

    expect(downloadFile).toHaveBeenCalledWith('big');
    expect(result).toMatchObject({ ok: true, kind: 'image', resourceId: 'res_1' });
    expect(saveImageResource).toHaveBeenCalledWith(
      expect.objectContaining({ mimeType: 'image/jpeg', caption: 'сирники', userId: USER_ID })
    );
  });

  it('uses the caption as the title', async () => {
    const result = await ingestPhoto({
      sizes: [{ file_id: 'a', width: 10, height: 10 }],
      caption: '  сирники  ',
      userId: USER_ID,
    });
    expect(result).toMatchObject({ ok: true, title: 'сирники' });
  });

  it('refuses a photo over the size cap without downloading it', async () => {
    const result = await ingestPhoto({
      sizes: [{ file_id: 'huge', width: 4000, height: 3000, file_size: 11 * 1024 * 1024 }],
      userId: USER_ID,
    });

    expect(result.ok).toBe(false);
    expect(downloadFile).not.toHaveBeenCalled();
  });

  it('reports a failed download rather than saving an empty resource', async () => {
    downloadFile.mockResolvedValue(null);
    const result = await ingestPhoto({
      sizes: [{ file_id: 'a', width: 10, height: 10 }],
      userId: USER_ID,
    });

    expect(result.ok).toBe(false);
    expect(saveImageResource).not.toHaveBeenCalled();
  });

  it('passes a missing blob URL through instead of failing the save', async () => {
    saveImageResource.mockResolvedValue({
      ok: true,
      resourceId: 'res_1',
      description: 'опис',
      imageUrl: null,
    });

    const result = await ingestPhoto({
      sizes: [{ file_id: 'a', width: 10, height: 10 }],
      userId: USER_ID,
    });

    expect(result).toMatchObject({ ok: true, imageUrl: null });
  });
});

describe('ingestDocument', () => {
  it('sends an image sent as a document down the image path', async () => {
    // What someone does when the picture is a page of text and Telegram's photo
    // compression would make it unreadable.
    const result = await ingestDocument({
      document: { file_id: 'd1', file_name: 'recipe.png', mime_type: 'image/png' },
      userId: USER_ID,
    });

    expect(saveImageResource).toHaveBeenCalledWith(
      expect.objectContaining({ mimeType: 'image/png', fileName: 'recipe.png' })
    );
    expect(extractTextFromFile).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: true, kind: 'image' });
  });

  it('recognises an image by extension when the mime type is useless', async () => {
    const result = await ingestDocument({
      document: { file_id: 'd1', file_name: 'shot.jpg', mime_type: 'application/octet-stream' },
      userId: USER_ID,
    });

    expect(result).toMatchObject({ ok: true, kind: 'image' });
  });

  it('extracts text from a PDF and stores it as a document', async () => {
    const result = await ingestDocument({
      document: { file_id: 'd2', file_name: 'plan.pdf', mime_type: 'application/pdf' },
      caption: 'план',
      userId: USER_ID,
    });

    expect(saveImageResource).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: true, kind: 'document', resourceId: 'res_2' });
    expect(createResource).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'текст із документа',
        title: 'план',
        metadata: expect.objectContaining({ type: 'document', fileName: 'plan.pdf' }),
      })
    );
  });

  it('does not save a resource when nothing could be extracted', async () => {
    extractTextFromFile.mockResolvedValue({ success: false, error: 'порожній PDF' });

    const result = await ingestDocument({
      document: { file_id: 'd3', file_name: 'empty.pdf', mime_type: 'application/pdf' },
      userId: USER_ID,
    });

    expect(result).toEqual({ ok: false, error: 'порожній PDF' });
    expect(createResource).not.toHaveBeenCalled();
  });

  it('treats whitespace-only extracted text as nothing extracted', async () => {
    extractTextFromFile.mockResolvedValue({ success: true, text: '   \n  ' });

    const result = await ingestDocument({
      document: { file_id: 'd4', file_name: 'blank.txt', mime_type: 'text/plain' },
      userId: USER_ID,
    });

    expect(result.ok).toBe(false);
    expect(createResource).not.toHaveBeenCalled();
  });
});
