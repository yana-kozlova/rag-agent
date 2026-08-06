import { extractText, getDocumentProxy } from 'unpdf';
import mammoth from 'mammoth';
import { describeImage, isSupportedImageMimeType, SUPPORTED_IMAGE_EXTENSIONS } from '@/lib/ai/vision';
import { extractTextFromEpub } from '@/lib/utils/epub';

export type ExtractionResult = {
  success: boolean;
  text?: string;
  error?: string;
};

/**
 * Validates file size
 */
export function validateFileSize(file: File, maxSizeMB: number): { valid: boolean; error?: string } {
  const maxSizeBytes = maxSizeMB * 1024 * 1024;
  if (file.size > maxSizeBytes) {
    return {
      valid: false,
      error: `File size exceeds maximum allowed size of ${maxSizeMB}MB`,
    };
  }
  return { valid: true };
}

/**
 * Gets file extension from filename
 */
export function getFileExtension(filename: string): string {
  const parts = filename.split('.');
  return parts.length > 1 ? parts[parts.length - 1]!.toLowerCase() : '';
}

/**
 * Gets MIME type from file extension
 */
export function getMimeTypeFromExtension(extension: string): string {
  const mimeTypes: Record<string, string> = {
    pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    doc: 'application/msword',
    epub: 'application/epub+zip',
    txt: 'text/plain',
    md: 'text/markdown',
    rtf: 'application/rtf',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
  };
  return mimeTypes[extension] || 'application/octet-stream';
}

/**
 * Is this an image, by either signal?
 *
 * Browsers set `file.type` reliably, but Telegram photos and a few desktop
 * clients send `application/octet-stream` and leave only the extension to go
 * on, so both are checked.
 */
export function isImageFile(mimeType: string, fileName: string): boolean {
  if (isSupportedImageMimeType(mimeType)) return true;

  const extension = getFileExtension(fileName);
  return (SUPPORTED_IMAGE_EXTENSIONS as readonly string[]).includes(extension);
}

/**
 * Extracts text from a file based on its MIME type
 */
export async function extractTextFromFile(
  file: File,
  mimeType: string,
  fileName: string,
  /** Tagged onto telemetry when reading the file costs an LLM call. */
  caller = 'file-extraction'
): Promise<ExtractionResult> {
  try {
    // PDF files
    if (mimeType === 'application/pdf' || fileName.toLowerCase().endsWith('.pdf')) {
      return await extractTextFromPDF(file);
    }

    // DOCX files
    if (
      mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      fileName.toLowerCase().endsWith('.docx')
    ) {
      return await extractTextFromDOCX(file);
    }

    // EPUB e-books. Checked before the text branch because some clients label
    // them `text/xml` — the extension is the reliable signal here.
    if (mimeType === 'application/epub+zip' || fileName.toLowerCase().endsWith('.epub')) {
      return await extractTextFromEpubFile(file);
    }

    // Plain text files
    if (
      mimeType.startsWith('text/') ||
      fileName.toLowerCase().endsWith('.txt') ||
      fileName.toLowerCase().endsWith('.md')
    ) {
      return await extractTextFromText(file);
    }

    // Images have no text to pull out, so one is written for them: a vision
    // model describes the image and transcribes anything written on it, and
    // that description becomes the resource's content. Everything downstream —
    // chunking, embedding, fact extraction — then works unchanged.
    if (isImageFile(mimeType, fileName)) {
      return await extractTextFromImage(file, mimeType, fileName, caller);
    }

    return {
      success: false,
      error: `Unsupported file type: ${mimeType}. Supported types: PDF, DOCX, EPUB, TXT, MD, JPEG, PNG, WebP, GIF`,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error during text extraction',
    };
  }
}

/**
 * Extracts text from PDF file using unpdf
 */
async function extractTextFromPDF(file: File): Promise<ExtractionResult> {
  try {
    const arrayBuffer = await file.arrayBuffer();
    // Convert ArrayBuffer to Uint8Array as required by unpdf
    const uint8Array = new Uint8Array(arrayBuffer);
    
    // Get PDF document proxy
    const pdf = await getDocumentProxy(uint8Array);
    
    // Extract text from all pages (mergePages: true merges all pages into one string)
    const { totalPages, text } = await extractText(pdf, { mergePages: true });
    
    if (!text || text.trim().length === 0) {
      return {
        success: false,
        error: totalPages === 0 
          ? 'PDF file appears to be empty or could not be parsed'
          : 'No text content found in PDF file',
      };
    }

    return {
      success: true,
      text: text.trim(),
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to extract text from PDF: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

/**
 * Extracts text from DOCX file using mammoth
 */
async function extractTextFromDOCX(file: File): Promise<ExtractionResult> {
  try {
    const arrayBuffer = await file.arrayBuffer();
    
    // Convert ArrayBuffer to Buffer for Node.js environment (mammoth works better with Buffer)
    const buffer = Buffer.from(arrayBuffer);
    
    // mammoth expects an object with buffer property in Node.js
    const result = await mammoth.extractRawText({ 
      buffer: buffer 
    });

    if (!result.value || result.value.trim().length === 0) {
      return {
        success: false,
        error: 'DOCX file appears to be empty or contains no extractable text',
      };
    }

    // Log warnings if any
    if (result.messages && result.messages.length > 0) {
      console.warn('DOCX extraction warnings:', result.messages);
    }

    return {
      success: true,
      text: result.value.trim(),
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to extract text from DOCX: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

/**
 * Extracts text from an EPUB e-book.
 *
 * The book's own title and author are prepended when the package document
 * carries them. A book's first page is rarely its title page in any useful
 * sense, so without this the only place the author's name appears may be a
 * copyright notice halfway through — and "what did I read by X?" then misses.
 */
async function extractTextFromEpubFile(file: File): Promise<ExtractionResult> {
  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const book = await extractTextFromEpub(bytes);

    if (!book.ok) {
      return { success: false, error: book.error };
    }

    const heading = [book.title, book.author].filter(Boolean).join(' — ');
    return {
      success: true,
      text: heading ? `${heading}\n\n${book.text}` : book.text,
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to read EPUB: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

/**
 * Describes an image with a vision model.
 *
 * The MIME type is re-derived from the extension when the caller's is useless:
 * Telegram and some desktop clients send `application/octet-stream`, and the
 * vision endpoint needs to be told what it is being handed.
 */
async function extractTextFromImage(
  file: File,
  mimeType: string,
  fileName: string,
  caller: string
): Promise<ExtractionResult> {
  try {
    const resolvedType = isSupportedImageMimeType(mimeType)
      ? mimeType
      : getMimeTypeFromExtension(getFileExtension(fileName));

    const bytes = Buffer.from(await file.arrayBuffer());
    const description = await describeImage(bytes, resolvedType, caller);

    if (!description.ok) {
      return { success: false, error: description.error };
    }

    return { success: true, text: description.text };
  } catch (error) {
    return {
      success: false,
      error: `Failed to read image: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

/**
 * Extracts text from plain text file
 */
async function extractTextFromText(file: File): Promise<ExtractionResult> {
  try {
    const text = await file.text();
    
    if (!text || text.trim().length === 0) {
      return {
        success: false,
        error: 'Text file appears to be empty',
      };
    }

    return {
      success: true,
      text: text.trim(),
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to read text file: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

