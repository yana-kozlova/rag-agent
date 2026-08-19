import { runAgent } from '@/lib/ai/agent';
import { runWithUser } from '@/lib/auth/context';
import { getGoogleAccessToken } from '@/lib/auth/google-token';
import { sendMessage, sendTyping } from '@/lib/telegram/api';
import { findUserByChatId, redeemLinkCode, unlinkChat } from '@/lib/telegram/link';
import { handleCallbackQuery, type TelegramCallbackQuery } from '@/lib/telegram/callbacks';
import { getConversationId, loadRecentTurns, persistTurn } from '@/lib/telegram/history';
import {
  isTranscriptionConfigured,
  transcribeVoice,
  type TranscriptionFailure,
} from '@/lib/telegram/transcribe';
import { downloadFile } from '@/lib/telegram/api';
import {
  ingestDocument,
  ingestPhoto,
  type MediaResult,
  type TelegramDocument,
  type TelegramPhotoSize,
} from '@/lib/telegram/media';
import {
  handleQuickActionReply,
  isQuickActionCommand,
  sendQuickActionList,
} from '@/lib/telegram/quick-actions';

/**
 * One Telegram update, handled end to end.
 *
 * Lives outside the routes because two of them run it: the webhook when there
 * is no queue to hand off to, and the QStash callback when there is.
 */

/** Only the fields this handler reads; Telegram sends far more. */
type TelegramUpdate = {
  message?: {
    chat?: { id?: number | string; type?: string };
    from?: { first_name?: string };
    text?: string;
    voice?: { file_id?: string };
    photo?: TelegramPhotoSize[];
    document?: TelegramDocument;
    caption?: string;
    /** Set when the user answered a `force_reply` — how a quick action gets its value. */
    reply_to_message?: { text?: string };
  };
  /** A button pressed under a notification this app sent. */
  callback_query?: TelegramCallbackQuery;
};

/**
 * The blob-store caveat is stated here rather than on every saved image.
 *
 * Vercel Blob has no private tier (see `lib/storage/images.ts`), so an
 * unguessable URL is the only thing protecting a stored picture. Telegram is
 * exactly where someone photographs a document without thinking about it, and
 * until now that trade-off lived only in a code comment — while the *failure*
 * to store got an explicit warning. Saying it once, where the feature is
 * described, beats a footnote on every upload that stops being read by the
 * third one.
 */
const HELP = [
  'Пиши, надиктовуй або кидай фото — я збережу, знайду, подивлюсь календар і запланую зустріч.',
  '',
  'Голосові розшифровуються автоматично.',
  'Фото й документи (PDF, DOCX, EPUB, TXT) потрапляють у базу знань — підпис до фото стає його назвою.',
  'Саме зображення лежить за невгадуваним, але публічним посиланням — не шли те, що не можна нікому показати.',
  '',
  '/q — швидкі записи: кнопки, що пишуть готовий рядок у таблицю без жодного запиту до моделі.',
  '/start <код> — прив’язати цей чат до акаунта',
  '/unlink — відв’язати цей чат (база знань лишається в акаунті)',
  '/help — це повідомлення',
].join('\n');

/**
 * Only private chats are served.
 *
 * A chat id is the entire identity here — `findUserByChatId` asks nothing about
 * *who* in that chat is speaking. In a group that would hand every member, and
 * everyone added later, the linked account's knowledge base and calendar. There
 * is no per-member check to add short of a second linking flow, so the answer
 * is that groups are not a place this bot works.
 */
function isPrivateChat(type: string | undefined): boolean {
  // Telegram always sends `type`; an update without one is malformed rather
  // than private, and is treated as the group case.
  return type === 'private';
}

export async function processUpdate(update: TelegramUpdate): Promise<void> {
  // A button press, not a message: no chat type to check and no agent to run,
  // and Telegram keeps the button spinning until it is acknowledged — so it
  // goes first and ends the turn.
  if (update?.callback_query) {
    await handleCallbackQuery(update.callback_query);
    return;
  }

  const message = update?.message;
  const rawChatId = message?.chat?.id;
  if (!message || rawChatId === undefined || rawChatId === null) return;

  const chatId = String(rawChatId);
  const text = (message.text ?? message.caption ?? '').trim();

  if (!isPrivateChat(message.chat?.type)) {
    // Answer commands, ignore the rest. Someone who typed `/start` in a group
    // is waiting for a reply and reads silence as a broken bot; the group's
    // ordinary chatter is not addressed to us and deserves no interruption.
    if (text.startsWith('/')) {
      await sendMessage(
        chatId,
        'Я працюю тільки в особистих повідомленнях — напиши мені напряму, і я допоможу.'
      );
    }
    return;
  }

  if (text.startsWith('/start')) {
    await handleStart(chatId, text);
    return;
  }

  if (text.startsWith('/unlink')) {
    await handleUnlink(chatId);
    return;
  }

  if (text.startsWith('/help')) {
    await sendMessage(chatId, HELP);
    return;
  }

  const user = await findUserByChatId(chatId);
  if (!user) {
    await sendMessage(
      chatId,
      'Цей чат ще не прив’язаний до акаунта. Відкрий налаштування у веб-застосунку, згенеруй код і надішли сюди «/start <код>».'
    );
    return;
  }

  // The button panel. A command rather than a persistent keyboard, because a
  // reply keyboard would sit under every message in the chat — including the
  // ones where you are asking a question — and these are for a specific moment.
  if (text && isQuickActionCommand(text)) {
    await sendQuickActionList(chatId, user.id);
    return;
  }

  // A reply to a quick action's prompt is a value, not a question: "37.2" sent
  // to the agent comes back as a polite enquiry about what that means.
  if (text && message.reply_to_message?.text) {
    const handled = await handleQuickActionReply(
      chatId,
      user.id,
      message.reply_to_message.text,
      text
    );
    if (handled) return;
  }

  // Photos and documents are saved rather than talked about. They arrive with
  // no question attached — someone photographing a recipe wants it kept, not
  // discussed — so this ends the turn instead of feeding the agent, which would
  // otherwise spend a step budget deciding what to do with a wall of OCR.
  if (message.photo || message.document) {
    await handleMedia(chatId, user.id, message);
    return;
  }

  if (!message.voice && !text) {
    // A sticker, a location, a contact card. Saying so beats silence, which
    // reads as the bot being broken.
    await sendMessage(chatId, 'Поки що я розумію текст, голосові, фото й документи.');
    return;
  }

  const prompt = message.voice ? await readVoice(chatId, message.voice.file_id) : text;
  if (!prompt) return;

  await sendTyping(chatId);

  try {
    const conversationId = await getConversationId(user.id);
    const history = await loadRecentTurns(conversationId);

    const result = await runWithUser(
      {
        id: user.id,
        name: user.name,
        surface: 'telegram',
        // Deferred: most messages never reach a calendar tool, and minting a
        // token costs a round-trip to Google.
        resolveAccessToken: () => getGoogleAccessToken(user.id),
      },
      () =>
        runAgent({
          messages: [...history, { role: 'user', content: prompt }],
          caller: 'telegram',
        })
    );

    // An answer can come back empty when the model spends its whole step budget
    // on tools; saying so beats sending a blank message.
    const answer =
      result.text?.trim() ||
      'Зробила, що просила, але не змогла це сформулювати. Спитай ще раз, будь ласка.';

    // Send before recording: if delivery fails, better that history is missing
    // a turn than that it claims one the user never saw and the next turn
    // builds on a phantom.
    await sendMessage(chatId, answer);
    await persistTurn(conversationId, prompt, answer);
  } catch (error) {
    console.error('[telegram] agent run failed:', error);
    await sendMessage(chatId, 'Щось пішло не так на моєму боці 😔 Спробуй ще раз.');
  }
}

async function handleStart(chatId: string, text: string): Promise<void> {
  const code = text.replace(/^\/start(@\S+)?/, '').trim();

  if (!code) {
    const existing = await findUserByChatId(chatId);
    await sendMessage(
      chatId,
      existing
        ? `Цей чат уже прив’язаний. ${HELP}`
        : 'Привіт! Щоб я мала доступ до твоєї бази знань і календаря, згенеруй код у налаштуваннях веб-застосунку і надішли «/start <код>».'
    );
    return;
  }

  const user = await redeemLinkCode(code, chatId);
  if (!user) {
    // Never distinguish "wrong" from "expired" — that difference is only
    // useful to someone guessing.
    await sendMessage(chatId, 'Код недійсний або прострочений. Згенеруй новий у налаштуваннях.');
    return;
  }

  await sendMessage(chatId, `Готово, чат прив’язано${user.name ? `, ${user.name}` : ''}. ${HELP}`);
}

async function handleUnlink(chatId: string): Promise<void> {
  const wasLinked = await unlinkChat(chatId);

  await sendMessage(
    chatId,
    wasLinked
      ? 'Готово, чат відв’язано — я більше не відповідаю тут від твого імені. Нічого не видалено: база знань і календар лишились в акаунті. Щоб повернутись, згенеруй новий код у веб-застосунку і надішли «/start <код>».'
      : 'Цей чат і так ні до чого не прив’язаний.'
  );
}

/**
 * How much of what was read to quote back.
 *
 * Enough to prove the picture was understood — a recipe's first ingredients, a
 * screenshot's first lines — without re-sending the whole transcription to
 * someone who is holding the original in their hand.
 */
const MEDIA_ECHO_LIMIT = 400;

/**
 * A photo or document → saved, with a receipt.
 *
 * The reply quotes what was actually read rather than saying "saved". Vision
 * output is the one thing in this app the user cannot check by looking at the
 * source: if the model misread a phone number off a receipt, the moment to
 * notice is now, while the paper is still on the table.
 */
async function handleMedia(
  chatId: string,
  userId: string,
  message: NonNullable<TelegramUpdate['message']>
): Promise<void> {
  await sendTyping(chatId);

  const caption = message.caption?.trim() || null;

  let result: MediaResult;
  try {
    result = message.photo
      ? await ingestPhoto({ sizes: message.photo, caption, userId })
      : await ingestDocument({ document: message.document ?? {}, caption, userId });
  } catch (error) {
    console.error('[telegram] media ingest threw:', error);
    await sendMessage(chatId, 'Не змогла обробити файл 😔 Спробуй ще раз.');
    return;
  }

  if (!result.ok) {
    await sendMessage(chatId, result.error);
    return;
  }

  const icon = result.kind === 'image' ? '🖼' : '📄';
  const excerpt =
    result.text.length > MEDIA_ECHO_LIMIT
      ? `${result.text.slice(0, MEDIA_ECHO_LIMIT).trimEnd()}…`
      : result.text;

  const lines = [`${icon} Зберегла: ${result.title}`, '', excerpt];

  // Worth mentioning only when it is missing: the picture will not be there to
  // look at later, which the sender should know now. The cause is a server
  // setting, so it goes to the log — the person holding the phone is not
  // necessarily the person who deployed this.
  if (result.kind === 'image' && !result.imageUrl) {
    console.warn('[telegram] image saved without a URL — BLOB_READ_WRITE_TOKEN is unset');
    lines.push('', '⚠️ Саме зображення не збереглось, але текст із нього вже в базі.');
  }

  await sendMessage(chatId, lines.join('\n'));
}

/**
 * What to say for each way a transcription can come back empty.
 *
 * Only the last one is about the recording, and only it should invite another
 * try — repeating a voice note at a server that has no transcription key is a
 * loop. The other two therefore say "write instead" rather than "try again",
 * but they no longer name the setting: whoever is speaking into this bot may be
 * a guest on someone else's deployment, and a missing env var is neither their
 * business nor theirs to fix. `lib/telegram/transcribe.ts` logs the specifics.
 */
const VOICE_FAILURE: Record<TranscriptionFailure, string> = {
  unconfigured: 'Розшифровка голосових тут не увімкнена. Напиши текстом, будь ласка.',
  unavailable: 'Сервіс розшифровки зараз не відповідає. Напиши текстом, будь ласка.',
  empty: 'Не вдалось розпізнати 🤷 Спробуй ще раз або напиши текстом.',
};

/** Voice note → text, echoed back so a misheard word is visible immediately. */
async function readVoice(chatId: string, fileId?: string): Promise<string | null> {
  if (!fileId) return null;

  // Checked up front only to skip a pointless download; `transcribeVoice`
  // reports the same failure on its own — including the log line, which is why
  // the short-circuit has to write one too.
  if (!isTranscriptionConfigured()) {
    console.warn('[telegram] voice note dropped — GROQ_API_KEY is unset');
    await sendMessage(chatId, VOICE_FAILURE.unconfigured);
    return null;
  }

  await sendTyping(chatId);

  const audio = await downloadFile(fileId);
  if (!audio) {
    await sendMessage(chatId, 'Не вдалось завантажити голосове 😔 Спробуй ще раз.');
    return null;
  }

  const result = await transcribeVoice(audio);
  if (!result.ok) {
    await sendMessage(chatId, VOICE_FAILURE[result.failure]);
    return null;
  }

  await sendMessage(chatId, `🎤 ${result.text}`);
  return result.text;
}
