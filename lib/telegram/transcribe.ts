import { env } from '@/lib/env.mjs';

/**
 * Voice notes → text, via Groq's whisper-large-v3-turbo.
 *
 * Carried over from the Python bot this replaces, where the same model and the
 * explicit `language: uk` hint were already proven on Ukrainian speech —
 * without the hint Whisper regularly decides short clips are Russian.
 *
 * Groq exposes an OpenAI-compatible route, so this is a plain multipart POST.
 */

const GROQ_TRANSCRIPTION_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';

const MODEL = 'whisper-large-v3-turbo';

export function isTranscriptionConfigured(): boolean {
  return Boolean(env.GROQ_API_KEY);
}

export async function transcribeVoice(
  audio: Buffer,
  /** Telegram voice notes are always OGG/Opus; documents may not be. */
  filename = 'voice.ogg'
): Promise<string | null> {
  const apiKey = env.GROQ_API_KEY;
  if (!apiKey) {
    console.warn('[telegram/transcribe] GROQ_API_KEY is unset; voice notes cannot be read');
    return null;
  }

  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(audio)]), filename);
  form.append('model', MODEL);
  form.append('language', 'uk');
  form.append('response_format', 'text');

  try {
    const res = await fetch(GROQ_TRANSCRIPTION_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });

    if (!res.ok) {
      console.error(
        `[telegram/transcribe] failed (${res.status}): ${await res.text().catch(() => '')}`
      );
      return null;
    }

    // `response_format: text` returns the bare transcript, not JSON.
    const text = (await res.text()).trim();
    return text || null;
  } catch (error) {
    console.error('[telegram/transcribe] threw:', error);
    return null;
  }
}
