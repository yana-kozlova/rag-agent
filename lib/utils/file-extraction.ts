import { extractText, getDocumentProxy } from 'unpdf';
import mammoth from 'mammoth';

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
    txt: 'text/plain',
    md: 'text/markdown',
    rtf: 'application/rtf',
  };
  return mimeTypes[extension] || 'application/octet-stream';
}

/**
 * Extracts text from a file based on its MIME type
 */
export async function extractTextFromFile(
  file: File,
  mimeType: string,
  fileName: string
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

    // Plain text files
    if (
      mimeType.startsWith('text/') ||
      fileName.toLowerCase().endsWith('.txt') ||
      fileName.toLowerCase().endsWith('.md')
    ) {
      return await extractTextFromText(file);
    }

    return {
      success: false,
      error: `Unsupported file type: ${mimeType}. Supported types: PDF, DOCX, TXT, MD`,
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

