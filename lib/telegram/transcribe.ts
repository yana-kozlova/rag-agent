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

/**
 * Why a transcription came back with no text.
 *
 * The distinction is not cosmetic. A missing or revoked key and a genuinely
 * unintelligible clip used to produce the same "не вдалось розпізнати" reply,
 * which reads as "speak more clearly" — so the one failure that no amount of
 * re-recording can fix is also the one that looks like the user's fault.
 */
export type TranscriptionFailure =
  /** No GROQ_API_KEY in this environment. */
  | 'unconfigured'
  /** Groq refused or never answered: bad key, spent quota, retired model, network. */
  | 'unavailable'
  /** The call succeeded but yielded nothing — silence, or too short to hear. */
  | 'empty';

export type TranscriptionResult =
  | { ok: true; text: string }
  | { ok: false; failure: TranscriptionFailure };

export async function transcribeVoice(
  audio: Buffer,
  /** Telegram voice notes are always OGG/Opus; documents may not be. */
  filename = 'voice.ogg'
): Promise<TranscriptionResult> {
  const apiKey = env.GROQ_API_KEY;
  if (!apiKey) {
    console.warn('[telegram/transcribe] GROQ_API_KEY is unset; voice notes cannot be read');
    return { ok: false, failure: 'unconfigured' };
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
      const body = await res.text().catch(() => '');

      // Worth its own line in the log: a rejected key survives every retry and
      // every re-recording, so it belongs next to the fix rather than buried in
      // a generic failure.
      if (res.status === 401 || res.status === 403) {
        console.error(
          `[telegram/transcribe] Groq rejected GROQ_API_KEY (${res.status}). ` +
            `Issue a new one at console.groq.com and set it in every environment. Body: ${body}`
        );
      } else {
        console.error(`[telegram/transcribe] failed (${res.status}): ${body}`);
      }

      return { ok: false, failure: 'unavailable' };
    }

    // `response_format: text` returns the bare transcript, not JSON.
    const text = (await res.text()).trim();
    return text ? { ok: true, text } : { ok: false, failure: 'empty' };
  } catch (error) {
    console.error('[telegram/transcribe] threw:', error);
    return { ok: false, failure: 'unavailable' };
  }
}
