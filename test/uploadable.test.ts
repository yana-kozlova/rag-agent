import { describe, expect, it } from 'vitest';
import {
  MAX_UPLOAD_SIZE_MB,
  UPLOAD_ACCEPT_ATTRIBUTE,
  fileExtensionOf,
  isUploadable,
  isUploadableImage,
  rejectionReason,
} from '@/lib/utils/uploadable';

/**
 * The gate every upload control shares.
 *
 * Worth its own tests because it is the one piece of the image path with no
 * network in it, and because both file pickers and the drop zone route their
 * decisions through it — a mistake here is a file silently vanishing.
 */

const under = MAX_UPLOAD_SIZE_MB * 1024 * 1024 - 1;
const over = MAX_UPLOAD_SIZE_MB * 1024 * 1024 + 1;

describe('fileExtensionOf', () => {
  it('lowercases, so a phone\'s IMG_0001.JPG is not turned away', () => {
    expect(fileExtensionOf('IMG_0001.JPG')).toBe('jpg');
  });

  it('takes the last segment of a multi-dot name', () => {
    expect(fileExtensionOf('scan.2026-08-06.final.png')).toBe('png');
  });

  it('is empty for a name with no extension', () => {
    expect(fileExtensionOf('screenshot')).toBe('');
  });
});

describe('isUploadableImage', () => {
  it.each(['photo.jpg', 'photo.jpeg', 'shot.PNG', 'sticker.webp', 'loop.gif'])(
    'accepts %s',
    (name) => {
      expect(isUploadableImage(name)).toBe(true);
    }
  );

  it.each(['notes.pdf', 'notes.md', 'raw.heic', 'vector.svg'])('rejects %s', (name) => {
    expect(isUploadableImage(name)).toBe(false);
  });

  it('separates images from documents, which are also uploadable', () => {
    expect(isUploadable('notes.pdf')).toBe(true);
    expect(isUploadableImage('notes.pdf')).toBe(false);
  });
});

describe('rejectionReason', () => {
  it('passes a normal image', () => {
    expect(rejectionReason({ name: 'receipt.jpg', size: under })).toBeNull();
  });

  it('names the file when it is too big', () => {
    const reason = rejectionReason({ name: 'huge.png', size: over });
    expect(reason).toContain('huge.png');
    expect(reason).toContain(String(MAX_UPLOAD_SIZE_MB));
  });

  it('names the file when the type is unsupported', () => {
    const reason = rejectionReason({ name: 'clip.mov', size: under });
    expect(reason).toContain('clip.mov');
  });

  it('reports size before type, so a huge .mov gives one reason not two', () => {
    expect(rejectionReason({ name: 'clip.mov', size: over })).toContain(
      String(MAX_UPLOAD_SIZE_MB)
    );
  });

  it('rejects an extensionless file rather than letting the server decide', () => {
    expect(rejectionReason({ name: 'pasted', size: under })).not.toBeNull();
  });
});

describe('UPLOAD_ACCEPT_ATTRIBUTE', () => {
  it('is a dot-prefixed comma list, which is what a file input expects', () => {
    for (const entry of UPLOAD_ACCEPT_ATTRIBUTE.split(',')) {
      expect(entry).toMatch(/^\.[a-z0-9]+$/);
    }
  });

  it('offers images alongside documents', () => {
    expect(UPLOAD_ACCEPT_ATTRIBUTE).toContain('.png');
    expect(UPLOAD_ACCEPT_ATTRIBUTE).toContain('.pdf');
  });
});
