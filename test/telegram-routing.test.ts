import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Which branch an update takes, before anything expensive happens.
 *
 * Everything the handler reaches for — the Bot API, the database, the agent —
 * is mocked; what is being asserted is the routing, and in two cases the
 * routing *is* the security property: a group chat must never reach a user's
 * data, and `/unlink` must work for someone who can no longer open the web app.
 */

vi.mock('@/lib/env.mjs', () => ({ env: {} }));

const sendMessage = vi.hoisted(() => vi.fn());
const sendTyping = vi.hoisted(() => vi.fn());
const downloadFile = vi.hoisted(() => vi.fn());
vi.mock('@/lib/telegram/api', () => ({ sendMessage, sendTyping, downloadFile }));

const findUserByChatId = vi.hoisted(() => vi.fn());
const redeemLinkCode = vi.hoisted(() => vi.fn());
const unlinkChat = vi.hoisted(() => vi.fn());
vi.mock('@/lib/telegram/link', () => ({ findUserByChatId, redeemLinkCode, unlinkChat }));

const runAgent = vi.hoisted(() => vi.fn());
vi.mock('@/lib/ai/agent', () => ({ runAgent }));

vi.mock('@/lib/auth/context', () => ({
  runWithUser: (_user: unknown, fn: () => unknown) => fn(),
}));
vi.mock('@/lib/auth/google-token', () => ({ getGoogleAccessToken: vi.fn() }));

const getConversationId = vi.hoisted(() => vi.fn());
const loadRecentTurns = vi.hoisted(() => vi.fn());
const persistTurn = vi.hoisted(() => vi.fn());
vi.mock('@/lib/telegram/history', () => ({ getConversationId, loadRecentTurns, persistTurn }));

const isTranscriptionConfigured = vi.hoisted(() => vi.fn());
const transcribeVoice = vi.hoisted(() => vi.fn());
vi.mock('@/lib/telegram/transcribe', () => ({ isTranscriptionConfigured, transcribeVoice }));

const ingestPhoto = vi.hoisted(() => vi.fn());
const ingestDocument = vi.hoisted(() => vi.fn());
vi.mock('@/lib/telegram/media', () => ({ ingestPhoto, ingestDocument }));

import { processUpdate } from '@/lib/telegram/process';

const USER = { id: '00000000-0000-0000-0000-000000000001', name: 'Яна' };

/** A private message, which is the only shape the handler serves. */
function privateMessage(fields: Record<string, unknown>) {
  return { message: { chat: { id: 42, type: 'private' }, ...fields } };
}

beforeEach(() => {
  findUserByChatId.mockResolvedValue(USER);
  unlinkChat.mockResolvedValue(true);
  getConversationId.mockResolvedValue('conv_1');
  loadRecentTurns.mockResolvedValue([]);
  runAgent.mockResolvedValue({ text: 'відповідь' });
  isTranscriptionConfigured.mockReturnValue(true);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('non-private chats', () => {
  it('never resolves a user for a group message', async () => {
    await processUpdate({
      message: { chat: { id: -100, type: 'supergroup' }, text: 'що там у мене завтра?' },
    });

    // The point of the guard: a chat id is the whole identity, so a group must
    // not be able to ask anything on a linked account's behalf.
    expect(findUserByChatId).not.toHaveBeenCalled();
    expect(runAgent).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('refuses to link a group even with a valid code', async () => {
    await processUpdate({
      message: { chat: { id: -100, type: 'group' }, text: '/start abc123' },
    });

    expect(redeemLinkCode).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith('-100', expect.stringContaining('особистих'));
  });

  it('treats an update with no chat type as a group rather than as private', async () => {
    await processUpdate({ message: { chat: { id: 7 }, text: 'привіт' } });

    expect(findUserByChatId).not.toHaveBeenCalled();
  });
});

describe('/unlink', () => {
  it('detaches the chat and says nothing was deleted', async () => {
    await processUpdate(privateMessage({ text: '/unlink' }));

    expect(unlinkChat).toHaveBeenCalledWith('42');
    expect(sendMessage.mock.calls[0][1]).toContain('відв’язано');
    expect(runAgent).not.toHaveBeenCalled();
  });

  it('works without a linked account, so a stale chat can still be cleaned up', async () => {
    findUserByChatId.mockResolvedValue(null);
    unlinkChat.mockResolvedValue(false);

    await processUpdate(privateMessage({ text: '/unlink' }));

    expect(unlinkChat).toHaveBeenCalledWith('42');
    expect(sendMessage.mock.calls[0][1]).toContain('ні до чого не прив’язаний');
  });
});

describe('unlinked chats', () => {
  it('points at the web app instead of answering', async () => {
    findUserByChatId.mockResolvedValue(null);

    await processUpdate(privateMessage({ text: 'хто я?' }));

    expect(runAgent).not.toHaveBeenCalled();
    expect(sendMessage.mock.calls[0][1]).toContain('/start');
  });
});

describe('operator settings stay out of the chat', () => {
  it('does not name the transcription key when voice is unconfigured', async () => {
    isTranscriptionConfigured.mockReturnValue(false);

    await processUpdate(privateMessage({ voice: { file_id: 'v1' } }));

    const reply = sendMessage.mock.calls[0][1] as string;
    expect(reply).not.toContain('GROQ');
    expect(reply).toContain('текстом');
    // Still discoverable by whoever can act on it.
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('GROQ_API_KEY'));
    expect(downloadFile).not.toHaveBeenCalled();
  });

  it('does not name the blob token when an image could not be stored', async () => {
    ingestPhoto.mockResolvedValue({
      ok: true,
      kind: 'image',
      title: 'Рецепт',
      text: 'сир, яйце, борошно',
      imageUrl: null,
    });

    await processUpdate(privateMessage({ photo: [{ file_id: 'p1', width: 1, height: 1 }] }));

    const reply = sendMessage.mock.calls[0][1] as string;
    expect(reply).not.toContain('BLOB');
    expect(reply).toContain('текст із нього вже в базі');
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('BLOB_READ_WRITE_TOKEN'));
  });
});
