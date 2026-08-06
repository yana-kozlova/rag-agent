import { describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';

// The extractor module pulls in the vision path, which wants env and the AI SDK.
vi.mock('@/lib/env.mjs', () => ({ env: {} }));
vi.mock('@/lib/ai/vision', () => ({
  describeImage: vi.fn(),
  isSupportedImageMimeType: (t: string) => t.startsWith('image/'),
  SUPPORTED_IMAGE_EXTENSIONS: ['jpg', 'jpeg', 'png', 'webp', 'gif'],
}));

import { extractTextFromFile, getMimeTypeFromExtension } from '@/lib/utils/file-extraction';

/**
 * The routing decision, not the parsing — that is covered in `epub.test.ts`.
 *
 * What matters here is that a book reaches the EPUB branch at all. Browsers
 * disagree about the MIME type of an `.epub`: some send `application/epub+zip`,
 * some send nothing, and Telegram has been seen sending `application/octet-stream`.
 */

async function tinyBook(): Promise<File> {
  const zip = new JSZip();
  zip.file(
    'META-INF/container.xml',
    `<container><rootfiles><rootfile full-path="content.opf"/></rootfiles></container>`
  );
  zip.file(
    'content.opf',
    `<package><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
       <dc:title>Кобзар</dc:title><dc:creator>Тарас Шевченко</dc:creator>
     </metadata>
     <manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest>
     <spine><itemref idref="c1"/></spine></package>`
  );
  zip.file('c1.xhtml', '<html><body><p>Реве та стогне Дніпр широкий.</p></body></html>');

  const bytes = await zip.generateAsync({ type: 'nodebuffer' });
  return new File([new Uint8Array(bytes)], 'kobzar.epub');
}

describe('extractTextFromFile with an EPUB', () => {
  it('maps the .epub extension to its MIME type', () => {
    expect(getMimeTypeFromExtension('epub')).toBe('application/epub+zip');
  });

  it.each([
    ['application/epub+zip', 'the declared type'],
    ['application/octet-stream', 'no useful type'],
    ['', 'no type at all'],
  ])('reads the book when the client sends %s (%s)', async (mimeType) => {
    const result = await extractTextFromFile(await tinyBook(), mimeType, 'kobzar.epub');

    expect(result.success).toBe(true);
    expect(result.text).toContain('Реве та стогне Дніпр широкий.');
  });

  it('puts title and author in front of the text, where search can reach them', async () => {
    const result = await extractTextFromFile(
      await tinyBook(),
      'application/epub+zip',
      'kobzar.epub'
    );

    expect(result.text?.startsWith('Кобзар — Тарас Шевченко')).toBe(true);
  });

  it('reports a broken book rather than saving an empty resource', async () => {
    const notABook = new File([new Uint8Array(Buffer.from('nope'))], 'broken.epub');

    const result = await extractTextFromFile(notABook, 'application/epub+zip', 'broken.epub');

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });
});
