import { NextResponse } from 'next/server';
import { auth } from '@/app/api/auth/auth';
import { createResource } from '@/lib/actions/resources';
import { extractTextFromFile, validateFileSize, getFileExtension, getMimeTypeFromExtension } from '@/lib/utils/file-extraction';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_FILE_SIZE_MB = 10;

export async function GET() {
  return NextResponse.json({ ok: true, message: 'Upload endpoint is available', method: 'GET' });
}

export async function POST(req: Request) {
  console.log('[UPLOAD ROUTE] POST handler called');
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json(
        { ok: false, message: 'Unauthorized' }, 
        { status: 401 }
      );
    }

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const title = formData.get('title') as string | null;

    if (!file) {
      return NextResponse.json(
        { ok: false, message: 'No file provided' }, 
        { status: 400 }
      );
    }

    const sizeValidation = validateFileSize(file, MAX_FILE_SIZE_MB);
    if (!sizeValidation.valid) {
      return NextResponse.json(
        { ok: false, message: sizeValidation.error }, 
        { status: 400 }
      );
    }

    const fileName = file.name;
    const fileExtension = getFileExtension(fileName);
    const mimeType = file.type || getMimeTypeFromExtension(fileExtension);
    const fileSize = file.size;

    let extractionResult;
    try {
      extractionResult = await extractTextFromFile(file, mimeType, fileName);
    } catch (extractionError: any) {
      console.error('Error during text extraction:', extractionError);
      return NextResponse.json({
        ok: false,
        message: extractionError?.message || 'Failed to extract text from file',
      }, { status: 400 });
    }

    if (!extractionResult.success) {
      return NextResponse.json({
        ok: false,
        message: extractionResult.error || 'Failed to extract text from file',
      }, { status: 400 });
    }

    if (!extractionResult.text || extractionResult.text.trim().length === 0) {
      return NextResponse.json(
        {
          ok: false,
          message: 'File appears to be empty or text could not be extracted',
        }, 
        { status: 400 }
      );
    }

    const resourceTitle = title || fileName;

    const result = await createResource({
      content: extractionResult.text,
      userId,
      title: resourceTitle,
      metadata: {
        type: 'document',
        fileName,
        mimeType,
        fileSize,
        fileExtension,
      },
    });

    if (!result.success) {
      return NextResponse.json(
        {
          ok: false,
          message: result.message || 'Failed to save resource',
        }, 
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      message: 'File uploaded and saved successfully',
      resourceId: result.id,
      fileName,
      fileSize,
      mimeType,
    });
  } catch (error: any) {
    console.error('POST /api/resources/upload error', error);
    return NextResponse.json(
      { ok: false, error: error?.message || 'Unknown error occurred' },
      { status: 500 }
    );
  }
}
