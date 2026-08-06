import JSZip from 'jszip';

/**
 * EPUB → plain text.
 *
 * An EPUB is a ZIP of XHTML files plus a manifest describing what order to read
 * them in. Reading it therefore means three steps, not one: find the package
 * document (`META-INF/container.xml` points at it), read the spine (the reading
 * order), then strip the markup out of each document in that order.
 *
 * The spine matters. Unzipping and concatenating every XHTML file sorted by
 * filename is the obvious shortcut and it reliably scrambles books — front
 * matter, footnotes and the copyright page land wherever the alphabet puts
 * them, and a retrieved chunk then reads as if it came from the middle of a
 * different chapter. Order is preserved so that a passage still has its
 * neighbours around it.
 *
 * No XML parser is pulled in. The two files that need reading (container and
 * package) have a flat, well-specified shape, and the content documents are
 * being reduced to text anyway, so a real parse would buy nothing.
 */

export type EpubExtraction =
  | { ok: true; text: string; title?: string; author?: string; chapters: number }
  | { ok: false; error: string };

/** Attribute value out of a single tag's source, either quoting style. */
function attr(tag: string, name: string): string | undefined {
  const double = tag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i'));
  if (double) return double[1];
  const single = tag.match(new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`, 'i'));
  return single?.[1];
}

/** Text of the first `<tag>` occurrence, markup stripped. */
function tagText(xml: string, name: string): string | undefined {
  const match = xml.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  if (!match) return undefined;
  const text = decodeEntities(match[1]!.replace(/<[^>]+>/g, '')).trim();
  return text.length > 0 ? text : undefined;
}

/** Collapse `a/./b/../c` to `a/c`, since hrefs are relative to the package. */
function normalizePath(path: string): string {
  const parts: string[] = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return parts.join('/');
}

function resolveHref(baseDir: string, href: string): string {
  let clean = href.split('#')[0]!;
  try {
    clean = decodeURIComponent(clean);
  } catch {
    // A malformed escape is not worth failing the book over — use it as-is.
  }
  return normalizePath(baseDir ? `${baseDir}/${clean}` : clean);
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  laquo: '«',
  raquo: '»',
  ldquo: '“',
  rdquo: '”',
  lsquo: '‘',
  rsquo: '’',
  shy: '',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body: string) => {
    if (body.startsWith('#')) {
      const code = body[1]?.toLowerCase() === 'x'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named !== undefined ? named : whole;
  });
}

/**
 * One content document to readable text.
 *
 * Block-level tags become line breaks before everything is stripped; without
 * that step a chapter collapses into a single run-on paragraph and the chunker
 * downstream, which splits on blank lines, has nothing to work with.
 */
function documentToText(xhtml: string): string {
  return decodeEntities(
    xhtml
      .replace(/<\?[\s\S]*?\?>/g, '')
      .replace(/<!DOCTYPE[\s\S]*?>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<head\b[\s\S]*?<\/head>/gi, '')
      .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '')
      .replace(/<br\b[^>]*>/gi, '\n')
      .replace(/<\/(p|div|li|tr|h[1-6]|blockquote|section|article)\s*>/gi, '\n\n')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t ]+/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Reading order from the package document.
 *
 * Returns absolute zip paths. Items the spine references but the manifest does
 * not describe are skipped rather than guessed at.
 */
function spinePaths(opf: string, baseDir: string): string[] {
  const manifest = new Map<string, { href: string; mediaType: string }>();
  for (const tag of opf.match(/<item\b[^>]*>/gi) ?? []) {
    const id = attr(tag, 'id');
    const href = attr(tag, 'href');
    if (!id || !href) continue;
    manifest.set(id, { href, mediaType: attr(tag, 'media-type') ?? '' });
  }

  const paths: string[] = [];
  for (const tag of opf.match(/<itemref\b[^>]*>/gi) ?? []) {
    const idref = attr(tag, 'idref');
    if (!idref) continue;
    const item = manifest.get(idref);
    if (!item) continue;
    // Cover images and SVG pages sit in the spine too; only markup is readable.
    if (item.mediaType && !/html/i.test(item.mediaType)) continue;
    paths.push(resolveHref(baseDir, item.href));
  }
  return paths;
}

export async function extractTextFromEpub(bytes: Buffer | Uint8Array): Promise<EpubExtraction> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch (error) {
    return {
      ok: false,
      error: `Not a readable EPUB: ${error instanceof Error ? error.message : 'unknown error'}`,
    };
  }

  // Store-bought books are commonly Adobe-DRM'd. Their XHTML unzips fine and
  // decodes to noise, so saying so beats embedding a few hundred chunks of
  // garbage and leaving the user to wonder why search stopped working.
  if (zip.file('META-INF/encryption.xml')) {
    return {
      ok: false,
      error: 'This EPUB is DRM-protected and cannot be read. Use a DRM-free copy.',
    };
  }

  // Zip paths are case-sensitive but authoring tools are not always consistent
  // about the case they write into the manifest.
  const byLowerPath = new Map<string, string>();
  zip.forEach((path) => byLowerPath.set(path.toLowerCase(), path));
  const read = async (path: string): Promise<string | null> => {
    const actual = zip.file(path) ? path : byLowerPath.get(path.toLowerCase());
    if (!actual) return null;
    const entry = zip.file(actual);
    return entry ? entry.async('string') : null;
  };

  let title: string | undefined;
  let author: string | undefined;
  let paths: string[] = [];

  const container = await read('META-INF/container.xml');
  const opfPath = container?.match(/<rootfile\b[^>]*>/i)?.[0];
  const opfHref = opfPath ? attr(opfPath, 'full-path') : undefined;

  if (opfHref) {
    const opf = await read(normalizePath(opfHref));
    if (opf) {
      const baseDir = normalizePath(opfHref).split('/').slice(0, -1).join('/');
      title = tagText(opf, 'dc:title') ?? tagText(opf, 'title');
      author = tagText(opf, 'dc:creator') ?? tagText(opf, 'creator');
      paths = spinePaths(opf, baseDir);
    }
  }

  // No container, no manifest, or a spine that resolved to nothing: fall back to
  // every content document in zip order. Worse ordering, but a book that reads
  // slightly out of sequence still answers questions; a hard failure does not.
  if (paths.length === 0) {
    const found: string[] = [];
    zip.forEach((path, entry) => {
      if (!entry.dir && /\.(x?html?|xhtml)$/i.test(path)) found.push(path);
    });
    paths = found.sort();
  }

  const chapters: string[] = [];
  for (const path of paths) {
    const source = await read(path);
    if (!source) continue;
    const text = documentToText(source);
    if (text.length > 0) chapters.push(text);
  }

  const text = chapters.join('\n\n').trim();
  if (text.length === 0) {
    return {
      ok: false,
      error: 'No text found in this EPUB — it may be a scanned book with images only.',
    };
  }

  return { ok: true, text, title, author, chapters: chapters.length };
}
