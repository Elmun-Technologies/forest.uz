import type { Transformer } from 'grammy';
import type { Update } from 'grammy/types';

/**
 * Fake Telegram transport (PROVIDERS_MODE=fake, tests): a grammY API transformer that records every
 * Bot API call and answers with synthetic results — nothing leaves the process. `getFile` answers
 * from files registered with `addFile` (tests simulate customer photos); chats in `blocked` answer
 * 403 like a user who blocked the bot. The `updates` helpers build the updates Telegram would POST.
 */
export interface FakeTelegramCall {
  method: string;
  payload: Record<string, unknown>;
  at: Date;
}

const SEND_METHODS = new Set(['sendMessage', 'sendPhoto', 'sendMediaGroup', 'copyMessage']);

export class FakeTelegramTransport {
  readonly calls: FakeTelegramCall[] = [];
  /** Chat ids (as strings) that answer 403 "bot was blocked by the user". */
  readonly blocked = new Set<string>();
  private readonly files = new Map<string, { path: string; bytes: Buffer }>();
  private messageSeq = 1000;

  constructor(private readonly mirror?: (chatId: string, text: string) => void) {}

  readonly transformer: Transformer = async (_prev, method, payload) => {
    const p = (payload ?? {}) as Record<string, unknown>;
    this.calls.push({ method, payload: p, at: new Date() });
    if (this.calls.length > 2000) this.calls.splice(0, this.calls.length - 2000);
    const chatId = p.chat_id === undefined ? null : String(p.chat_id);
    if (chatId && SEND_METHODS.has(method) && this.blocked.has(chatId))
      return {
        ok: false,
        error_code: 403,
        description: 'Forbidden: bot was blocked by the user',
      } as never;
    return { ok: true, result: this.result(method, p, chatId) } as never;
  };

  private result(method: string, p: Record<string, unknown>, chatId: string | null): unknown {
    switch (method) {
      case 'sendMessage':
      case 'sendPhoto': {
        const text = String(p.text ?? p.caption ?? '');
        if (chatId) this.mirror?.(chatId, text);
        return {
          message_id: ++this.messageSeq,
          date: Math.floor(Date.now() / 1000),
          chat: { id: Number(chatId), type: 'private' },
          ...(method === 'sendPhoto' ? { caption: text } : { text }),
        };
      }
      case 'getFile': {
        const id = String(p.file_id ?? '');
        const f = this.files.get(id);
        return { file_id: id, file_unique_id: id, file_size: f?.bytes.length, file_path: f?.path };
      }
      case 'getMe':
        return { id: 1, is_bot: true, first_name: 'Forest', username: 'forest_fake_bot' };
      case 'editMessageReplyMarkup':
      case 'editMessageText':
        return true;
      default:
        return true;
    }
  }

  addFile(fileId: string, bytes: Buffer, path = `photos/${fileId}.jpg`): void {
    this.files.set(fileId, { path, bytes });
  }

  download(path: string): Buffer | null {
    for (const f of this.files.values()) if (f.path === path) return f.bytes;
    return null;
  }

  /** Messages sent to a chat (sendMessage/sendPhoto), oldest first. */
  sent(chatId?: string | number | bigint): FakeTelegramCall[] {
    return this.calls.filter(
      (c) =>
        SEND_METHODS.has(c.method) &&
        (chatId === undefined || String(c.payload.chat_id) === String(chatId)),
    );
  }

  clear(): void {
    this.calls.length = 0;
    this.blocked.clear();
  }
}

/** Builders for the updates Telegram posts to the webhook (tests and the dev endpoint). */
let updateSeq = Math.floor(Math.random() * 1e8);

function user(id: number, opts: { firstName?: string; languageCode?: string } = {}) {
  return {
    id,
    is_bot: false,
    first_name: opts.firstName ?? 'Mijoz',
    language_code: opts.languageCode ?? 'uz',
  };
}

function messageBase(chatId: number, opts: { firstName?: string; languageCode?: string } = {}) {
  return {
    message_id: ++updateSeq,
    date: Math.floor(Date.now() / 1000),
    chat: { id: chatId, type: 'private' as const, first_name: opts.firstName ?? 'Mijoz' },
    from: user(chatId, opts),
  };
}

export const fakeUpdates = {
  text(
    chatId: number,
    text: string,
    opts: { firstName?: string; languageCode?: string } = {},
  ): Update {
    const command = text.startsWith('/') ? text.split(/\s/)[0]!.length : 0;
    return {
      update_id: ++updateSeq,
      message: {
        ...messageBase(chatId, opts),
        text,
        ...(command ? { entities: [{ type: 'bot_command', offset: 0, length: command }] } : {}),
      },
    } as Update;
  },
  contact(chatId: number, phone: string, ownerId: number = chatId): Update {
    return {
      update_id: ++updateSeq,
      message: {
        ...messageBase(chatId),
        contact: { phone_number: phone, first_name: 'Mijoz', user_id: ownerId },
      },
    } as Update;
  },
  photo(chatId: number, fileId: string, caption?: string): Update {
    return {
      update_id: ++updateSeq,
      message: {
        ...messageBase(chatId),
        photo: [
          { file_id: `${fileId}-s`, file_unique_id: `${fileId}-s`, width: 90, height: 90 },
          { file_id: fileId, file_unique_id: fileId, width: 1280, height: 960 },
        ],
        ...(caption ? { caption } : {}),
      },
    } as Update;
  },
  callback(chatId: number, data: string, messageId = 1): Update {
    return {
      update_id: ++updateSeq,
      callback_query: {
        id: String(++updateSeq),
        from: user(chatId),
        chat_instance: String(chatId),
        data,
        message: {
          message_id: messageId,
          date: Math.floor(Date.now() / 1000),
          chat: { id: chatId, type: 'private', first_name: 'Mijoz' },
          text: '…',
        },
      },
    } as Update;
  },
  blocked(chatId: number): Update {
    return {
      update_id: ++updateSeq,
      my_chat_member: {
        chat: { id: chatId, type: 'private', first_name: 'Mijoz' },
        from: user(chatId),
        date: Math.floor(Date.now() / 1000),
        old_chat_member: { status: 'member', user: { id: 1, is_bot: true, first_name: 'Forest' } },
        new_chat_member: {
          status: 'kicked',
          until_date: 0,
          user: { id: 1, is_bot: true, first_name: 'Forest' },
        },
      },
    } as Update;
  },
};
