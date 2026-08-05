import { runAgent } from '@/lib/ai/agent';
import { runWithUser } from '@/lib/auth/context';
import { getGoogleAccessToken } from '@/lib/auth/google-token';
import { sendMessage, sendTyping } from '@/lib/telegram/api';
import { findUserByChatId, redeemLinkCode } from '@/lib/telegram/link';
import { getConversationId, loadRecentTurns, persistTurn } from '@/lib/telegram/history';
import { isTranscriptionConfigured, transcribeVoice } from '@/lib/telegram/transcribe';
import { downloadFile } from '@/lib/telegram/api';

/**
 * One Telegram update, handled end to end.
 *
 * Lives outside the routes because two of them run it: the webhook when there
 * is no queue to hand off to, and the QStash callback when there is.
 */

/** Only the fields this handler reads; Telegram sends far more. */
type TelegramUpdate = {
  message?: {
    chat?: { id?: number | string };
    from?: { first_name?: string };
    text?: string;
    voice?: { file_id?: string };
    caption?: string;
  };
};

const HELP = [
  'Пиши або надиктовуй — я збережу, знайду, подивлюсь календар і запланую зустріч.',
  '',
  'Голосові розшифровуються автоматично.',
  '/start <код> — прив’язати цей чат до акаунта',
  '/help — це повідомлення',
].join('\n');

export async function processUpdate(update: TelegramUpdate): Promise<void> {
  const message = update?.message;
  const rawChatId = message?.chat?.id;
  if (!message || rawChatId === undefined || rawChatId === null) return;

  const chatId = String(rawChatId);
  const text = (message.text ?? message.caption ?? '').trim();

  if (text.startsWith('/start')) {
    await handleStart(chatId, text);
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

  if (!message.voice && !text) {
    // A sticker, photo or location. Saying so beats silence, which reads as the
    // bot being broken.
    await sendMessage(chatId, 'Поки що я розумію тільки текст і голосові.');
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

/** Voice note → text, echoed back so a misheard word is visible immediately. */
async function readVoice(chatId: string, fileId?: string): Promise<string | null> {
  if (!fileId) return null;

  if (!isTranscriptionConfigured()) {
    await sendMessage(chatId, 'Голосові поки не налаштовані — напиши текстом, будь ласка.');
    return null;
  }

  await sendTyping(chatId);

  const audio = await downloadFile(fileId);
  if (!audio) {
    await sendMessage(chatId, 'Не вдалось завантажити голосове 😔 Спробуй ще раз.');
    return null;
  }

  const transcript = await transcribeVoice(audio);
  if (!transcript) {
    await sendMessage(chatId, 'Не вдалось розпізнати 🤷 Спробуй ще раз або напиши текстом.');
    return null;
  }

  await sendMessage(chatId, `🎤 ${transcript}`);
  return transcript;
}
