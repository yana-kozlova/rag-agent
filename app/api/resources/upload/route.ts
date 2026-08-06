import { NextResponse } from 'next/server';
import { auth } from '@/app/api/auth/auth';
import { createResource } from '@/lib/actions/resources';
import { saveImageResource } from '@/lib/actions/save-image';
import { extractTextFromFile, validateFileSize, getFileExtension, getMimeTypeFromExtension, isImageFile } from '@/lib/utils/file-extraction';
// The cap the file pickers enforce client-side. Shared so the browser and this
// route cannot disagree about what fits.
import { MAX_UPLOAD_SIZE_MB } from '@/lib/utils/uploadable';

export const runtime = 'nodejs';
export const maxDuration = 60;

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

    const sizeValidation = validateFileSize(file, MAX_UPLOAD_SIZE_MB);
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

    // Images take their own path: the bytes are kept so the picture can be
    // shown again, which no other upload here needs.
    if (isImageFile(mimeType, fileName)) {
      const saved = await saveImageResource({
        bytes: Buffer.from(await file.arrayBuffer()),
        fileName,
        mimeType,
        userId,
        title,
        caller: 'upload',
      });

      if (!saved.ok) {
        return NextResponse.json({ ok: false, message: saved.error }, { status: 400 });
      }

      return NextResponse.json({
        ok: true,
        message: 'Image uploaded and saved successfully',
        resourceId: saved.resourceId,
        imageUrl: saved.imageUrl,
        fileName,
        fileSize,
        mimeType,
      });
    }

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
