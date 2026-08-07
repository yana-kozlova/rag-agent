import { env } from '@/lib/env.mjs';

/**
 * Minimal Telegram Bot API client — only the calls this app makes.
 *
 * Deliberately no SDK: every method here is one `fetch`, and the bot runs as a
 * webhook rather than a long-running polling process, so there is no update
 * loop, dispatcher or job queue to inherit.
 */

const API_ORIGIN = 'https://api.telegram.org';

/** Telegram rejects anything longer; replies get split rather than truncated. */
const MAX_MESSAGE_LENGTH = 4096;

export function isTelegramConfigured(): boolean {
  return Boolean(env.TELEGRAM_BOT_TOKEN);
}

async function call<T>(method: string, body: unknown): Promise<T | null> {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.warn(`[telegram] ${method} skipped: TELEGRAM_BOT_TOKEN is unset`);
    return null;
  }

  try {
    const res = await fetch(`${API_ORIGIN}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const payload = (await res.json().catch(() => null)) as
      | { ok: boolean; result?: T; description?: string }
      | null;

    if (!payload?.ok) {
      console.error(`[telegram] ${method} failed: ${payload?.description ?? res.status}`);
      return null;
    }
    return payload.result ?? null;
  } catch (error) {
    console.error(`[telegram] ${method} threw:`, error);
    return null;
  }
}

/**
 * Split on paragraph, then line, then hard boundaries — so a long answer breaks
 * where a reader would break it, not mid-word.
 */
export function splitForTelegram(text: string): string[] {
  if (text.length <= MAX_MESSAGE_LENGTH) return [text];

  const parts: string[] = [];
  let rest = text;

  while (rest.length > MAX_MESSAGE_LENGTH) {
    const at = cutPoint(rest.slice(0, MAX_MESSAGE_LENGTH));
    parts.push(rest.slice(0, at).trimEnd());
    rest = rest.slice(at).trimStart();
  }

  if (rest) parts.push(rest);
  return parts;
}

/**
 * Where to break a full-length window.
 *
 * Separators are tried in order of how natural the break reads, and the first
 * that leaves a reasonably full message wins — a paragraph break is preferred
 * even when a mere space sits further along. A window with no separator at all
 * (an unbroken code blob, say) is cut at the limit.
 */
function cutPoint(window: string): number {
  const minimumFill = MAX_MESSAGE_LENGTH * 0.5;

  for (const separator of ['\n\n', '\n', ' ']) {
    const at = window.lastIndexOf(separator);
    if (at > minimumFill) return at;
  }

  return MAX_MESSAGE_LENGTH;
}

/**
 * Rewrite Markdown links into something a plain-text message can carry.
 *
 * The assistant is told to link what it finds, and the web chat renders those
 * links. Here there is no `parse_mode` (see `sendMessage`), so `[Рецепт](/resources/x)`
 * would arrive as literal brackets around a path that resolves to nothing —
 * the app's own paths only mean something under its origin. So the label is
 * kept as prose and the address is spelled out in full, which Telegram
 * autolinks by itself. A target that is neither a path nor a URL was never an
 * address; only its label survives.
 */
export function flattenMarkdownLinks(text: string): string {
  const origin = (env.APP_URL || env.NEXTAUTH_URL || '').replace(/\/+$/, '');

  return text.replace(/\[([^\]]*)\]\(([^()\s]*)\)/g, (whole, label: string, href: string) => {
    const target = /^\/(?!\/)/.test(href) ? (origin ? `${origin}${href}` : '') : href;
    if (!/^https?:\/\//i.test(target)) return label || whole;
    return label && label !== target ? `${label}: ${target}` : target;
  });
}

/**
 * Send a reply, as plain text.
 *
 * No `parse_mode` on purpose: the model writes ordinary Markdown, while
 * Telegram's MarkdownV2 demands that a dozen characters be backslash-escaped
 * and rejects the whole message otherwise. Sending an unstyled message that
 * always arrives beats a styled one that intermittently 400s.
 *
 * Returns whether every piece went out. Replies ignore this — there is nobody
 * to tell — but scheduled notifications need it: the queue marks a row `sent`
 * or `failed` on the strength of this answer, and a silent `void` would retire
 * rows that never reached anyone.
 */
export async function sendMessage(
  chatId: string | number,
  text: string,
  options: { replyMarkup?: unknown } = {}
): Promise<boolean> {
  const pieces = splitForTelegram(flattenMarkdownLinks(text).trim() || '…');
  let delivered = true;

  for (const [index, piece] of pieces.entries()) {
    const sent = await call('sendMessage', {
      chat_id: chatId,
      text: piece,
      // Buttons belong on the last piece, where the reply actually ends.
      reply_markup: index === pieces.length - 1 ? options.replyMarkup : undefined,
      disable_web_page_preview: true,
    });

    // `sendMessage` answers with the Message it created, so null is `call`
    // reporting a rejected request rather than an empty success.
    if (sent === null) delivered = false;
  }

  return delivered;
}

/**
 * Acknowledge a button press.
 *
 * Telegram shows a loading state on the button until this is called, so it has
 * to happen whatever the outcome — including on failure, where the `text` is
 * the only place the user learns that nothing happened.
 */
export async function answerCallbackQuery(
  callbackQueryId: string,
  text?: string
): Promise<void> {
  await call('answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    text,
  });
}

/**
 * Take the buttons off a message that has already been acted on.
 *
 * Without this the keyboard stays live forever, and "Save" on a week-old
 * briefing quietly writes a second copy into the knowledge base.
 */
export async function clearReplyMarkup(
  chatId: string | number,
  messageId: number
): Promise<void> {
  await call('editMessageReplyMarkup', {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: { inline_keyboard: [] },
  });
}

/** The "typing…" indicator. Expires after ~5s on its own. */
export async function sendTyping(chatId: string | number): Promise<void> {
  await call('sendChatAction', { chat_id: chatId, action: 'typing' });
}

/** Cached: the bot's username never changes while the process lives. */
let cachedUsername: string | null = null;

/** The bot's @username, for building a `t.me/<bot>?start=…` deep link. */
export async function getBotUsername(): Promise<string | null> {
  if (cachedUsername) return cachedUsername;

  const me = await call<{ username?: string }>('getMe', {});
  cachedUsername = me?.username ?? null;
  return cachedUsername;
}

/** Download a file (voice note, document) the user sent. */
export async function downloadFile(fileId: string): Promise<Buffer | null> {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;

  const file = await call<{ file_path?: string }>('getFile', { file_id: fileId });
  if (!file?.file_path) return null;

  try {
    const res = await fetch(`${API_ORIGIN}/file/bot${token}/${file.file_path}`);
    if (!res.ok) {
      console.error(`[telegram] file download failed: ${res.status}`);
      return null;
    }
    return Buffer.from(await res.arrayBuffer());
  } catch (error) {
    console.error('[telegram] file download threw:', error);
    return null;
  }
}
