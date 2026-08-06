import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The order of the two side effects an image upload has, and what happens when
 * each fails.
 *
 * This is the whole contract of `saveImageResource` and it is not obvious from
 * reading it: describing and storing look symmetrical, but they are not. A
 * description that fails means an image nothing can ever find, so it aborts; a
 * store that fails only means the picture cannot be shown back, so it does not.
 */

// Hoisted alongside the `vi.mock` factories, which otherwise run before these
// declarations exist.
const { describeImage, storeImage, createResource } = vi.hoisted(() => ({
  describeImage: vi.fn(),
  storeImage: vi.fn(),
  createResource: vi.fn(),
}));

vi.mock('@/lib/ai/vision', () => ({ describeImage }));
vi.mock('@/lib/storage/images', () => ({ storeImage }));
vi.mock('@/lib/actions/resources', () => ({ createResource }));
vi.mock('@/lib/utils/file-extraction', () => ({
  getFileExtension: (name: string) => name.split('.').pop()?.toLowerCase() ?? '',
}));

import { saveImageResource } from '@/lib/actions/save-image';

const BYTES = Buffer.from('pretend jpeg');

function input(overrides: Record<string, unknown> = {}) {
  return {
    bytes: BYTES,
    fileName: 'receipt.jpg',
    mimeType: 'image/jpeg',
    userId: 'user-1',
    caller: 'test',
    ...overrides,
  } as Parameters<typeof saveImageResource>[0];
}

/** What the resource row would have been, without a database to ask. */
function savedResource() {
  expect(createResource).toHaveBeenCalledTimes(1);
  return createResource.mock.calls[0][0];
}

beforeEach(() => {
  vi.clearAllMocks();
  describeImage.mockResolvedValue({ ok: true, text: 'A receipt for 240 UAH from the vet.' });
  storeImage.mockResolvedValue({ url: 'https://blob.example/receipt.jpg', pathname: 'images/u/r.jpg' });
  createResource.mockResolvedValue({ success: true, id: 'res-1' });
});

describe('saveImageResource', () => {
  it('files the description as the content of an image resource', async () => {
    const result = await saveImageResource(input());

    expect(result).toEqual({
      ok: true,
      resourceId: 'res-1',
      description: 'A receipt for 240 UAH from the vet.',
      imageUrl: 'https://blob.example/receipt.jpg',
    });

    const resource = savedResource();
    expect(resource.content).toBe('A receipt for 240 UAH from the vet.');
    expect(resource.metadata.type).toBe('image');
    expect(resource.metadata.imageUrl).toBe('https://blob.example/receipt.jpg');
    expect(resource.metadata.fileSize).toBe(BYTES.length);
  });

  it('puts the caption first, where the first embedded chunk will pick it up', async () => {
    await saveImageResource(input({ caption: 'Vet bill, Sonya' }));

    const resource = savedResource();
    expect(resource.content.startsWith('Vet bill, Sonya')).toBe(true);
    expect(resource.content).toContain('A receipt for 240 UAH from the vet.');
    expect(resource.metadata.caption).toBe('Vet bill, Sonya');
  });

  it('titles the resource by caption, then filename', async () => {
    await saveImageResource(input({ caption: 'Vet bill' }));
    expect(savedResource().title).toBe('Vet bill');

    vi.clearAllMocks();
    createResource.mockResolvedValue({ success: true, id: 'res-2' });
    await saveImageResource(input());
    expect(savedResource().title).toBe('receipt.jpg');
  });

  it('lets an explicit title win over the caption', async () => {
    await saveImageResource(input({ title: 'Chosen', caption: 'Ignored' }));
    expect(savedResource().title).toBe('Chosen');
  });

  it('saves the resource anyway when the blob store is unavailable', async () => {
    storeImage.mockResolvedValue(null);

    const result = await saveImageResource(input());

    expect(result).toMatchObject({ ok: true, imageUrl: null });
    // Absent rather than null: the UI shows a thumbnail on the key existing.
    expect(savedResource().metadata).not.toHaveProperty('imageUrl');
  });

  it('aborts without saving when the image could not be read', async () => {
    describeImage.mockResolvedValue({ ok: false, error: 'Unsupported image type' });

    const result = await saveImageResource(input());

    expect(result).toEqual({ ok: false, error: 'Unsupported image type' });
    expect(createResource).not.toHaveBeenCalled();
    // And nothing is uploaded either — an unreadable image is not worth storing.
    expect(storeImage).not.toHaveBeenCalled();
  });

  it('reports a failed insert rather than claiming success', async () => {
    createResource.mockResolvedValue({ success: false, message: 'db down' });

    expect(await saveImageResource(input())).toEqual({ ok: false, error: 'db down' });
  });
});
