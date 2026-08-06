import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { extractTextFromEpub } from '@/lib/utils/epub';

/**
 * EPUB extraction, on books built here rather than checked in as fixtures.
 *
 * The format is a ZIP plus two small XML files, so constructing one in the test
 * costs a few lines and buys the ability to state the awkward cases outright —
 * a spine that disagrees with alphabetical order, a missing container, DRM.
 */

const CONTAINER = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

function packageDocument(
  items: Array<{ id: string; href: string; mediaType?: string }>,
  spine: string[],
  meta: { title?: string; author?: string } = {}
): string {
  return `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    ${meta.title ? `<dc:title>${meta.title}</dc:title>` : ''}
    ${meta.author ? `<dc:creator>${meta.author}</dc:creator>` : ''}
  </metadata>
  <manifest>
    ${items
      .map(
        (i) =>
          `<item id="${i.id}" href="${i.href}" media-type="${i.mediaType ?? 'application/xhtml+xml'}"/>`
      )
      .join('\n    ')}
  </manifest>
  <spine>
    ${spine.map((id) => `<itemref idref="${id}"/>`).join('\n    ')}
  </spine>
</package>`;
}

function chapter(body: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>ignored</title><style>p { margin: 0 }</style></head>
<body>${body}</body>
</html>`;
}

async function buildEpub(files: Record<string, string>): Promise<Buffer> {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(files)) {
    zip.file(path, content);
  }
  return zip.generateAsync({ type: 'nodebuffer' });
}

/** A three-chapter book whose spine order is not its filename order. */
async function shuffledBook(): Promise<Buffer> {
  return buildEpub({
    'META-INF/container.xml': CONTAINER,
    'OEBPS/content.opf': packageDocument(
      [
        { id: 'c1', href: 'zebra.xhtml' },
        { id: 'c2', href: 'apple.xhtml' },
        { id: 'c3', href: 'mango.xhtml' },
      ],
      ['c1', 'c2', 'c3'],
      { title: 'Дюна', author: 'Френк Герберт' }
    ),
    'OEBPS/zebra.xhtml': chapter('<h1>Розділ перший</h1><p>Початок.</p>'),
    'OEBPS/apple.xhtml': chapter('<p>Середина.</p>'),
    'OEBPS/mango.xhtml': chapter('<p>Кінець.</p>'),
  });
}

describe('extractTextFromEpub', () => {
  it('reads chapters in spine order, not filename order', async () => {
    const result = await extractTextFromEpub(await shuffledBook());

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const positions = ['Початок.', 'Середина.', 'Кінець.'].map((s) => result.text.indexOf(s));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it('returns the book title and author from the package metadata', async () => {
    const result = await extractTextFromEpub(await shuffledBook());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.title).toBe('Дюна');
    expect(result.author).toBe('Френк Герберт');
    expect(result.chapters).toBe(3);
  });

  it('drops head, style and script content', async () => {
    const result = await extractTextFromEpub(await shuffledBook());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).not.toContain('ignored');
    expect(result.text).not.toContain('margin');
  });

  it('keeps paragraphs apart so the chunker has boundaries to split on', async () => {
    const epub = await buildEpub({
      'META-INF/container.xml': CONTAINER,
      'OEBPS/content.opf': packageDocument([{ id: 'c1', href: 'c1.xhtml' }], ['c1']),
      'OEBPS/c1.xhtml': chapter('<p>Перший абзац.</p><p>Другий абзац.</p>'),
    });

    const result = await extractTextFromEpub(epub);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toBe('Перший абзац.\n\nДругий абзац.');
  });

  it('decodes entities, including numeric ones', async () => {
    const epub = await buildEpub({
      'META-INF/container.xml': CONTAINER,
      'OEBPS/content.opf': packageDocument([{ id: 'c1', href: 'c1.xhtml' }], ['c1']),
      'OEBPS/c1.xhtml': chapter('<p>&laquo;Так&raquo; &amp; &#1090;&#1072;&#1082;&hellip;</p>'),
    });

    const result = await extractTextFromEpub(epub);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toBe('«Так» & так…');
  });

  it('resolves hrefs relative to the package document, including percent-escapes', async () => {
    const epub = await buildEpub({
      'META-INF/container.xml': CONTAINER,
      'OEBPS/content.opf': packageDocument(
        [{ id: 'c1', href: 'text/chapter%201.xhtml' }],
        ['c1']
      ),
      'OEBPS/text/chapter 1.xhtml': chapter('<p>Знайшлось.</p>'),
    });

    const result = await extractTextFromEpub(epub);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toContain('Знайшлось.');
  });

  it('skips spine items that are not markup', async () => {
    const epub = await buildEpub({
      'META-INF/container.xml': CONTAINER,
      'OEBPS/content.opf': packageDocument(
        [
          { id: 'cover', href: 'cover.png', mediaType: 'image/png' },
          { id: 'c1', href: 'c1.xhtml' },
        ],
        ['cover', 'c1']
      ),
      'OEBPS/cover.png': 'not really a png',
      'OEBPS/c1.xhtml': chapter('<p>Текст.</p>'),
    });

    const result = await extractTextFromEpub(epub);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toBe('Текст.');
    expect(result.chapters).toBe(1);
  });

  it('falls back to every content document when there is no container', async () => {
    const epub = await buildEpub({
      'a.xhtml': chapter('<p>Один.</p>'),
      'b.xhtml': chapter('<p>Два.</p>'),
    });

    const result = await extractTextFromEpub(epub);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toContain('Один.');
    expect(result.text).toContain('Два.');
  });

  it('names DRM as the reason rather than embedding the noise', async () => {
    const epub = await buildEpub({
      'META-INF/container.xml': CONTAINER,
      'META-INF/encryption.xml': '<encryption/>',
      'OEBPS/content.opf': packageDocument([{ id: 'c1', href: 'c1.xhtml' }], ['c1']),
      'OEBPS/c1.xhtml': chapter('<p></p>'),
    });

    const result = await extractTextFromEpub(epub);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/DRM/i);
  });

  it('reports a book with no readable text instead of saving an empty resource', async () => {
    const epub = await buildEpub({
      'META-INF/container.xml': CONTAINER,
      'OEBPS/content.opf': packageDocument([{ id: 'c1', href: 'c1.xhtml' }], ['c1']),
      'OEBPS/c1.xhtml': chapter('<p><img src="page-001.jpg"/></p>'),
    });

    const result = await extractTextFromEpub(epub);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/no text/i);
  });

  it('rejects a file that is not a zip at all', async () => {
    const result = await extractTextFromEpub(Buffer.from('this is a plain text file'));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/not a readable epub/i);
  });
});
