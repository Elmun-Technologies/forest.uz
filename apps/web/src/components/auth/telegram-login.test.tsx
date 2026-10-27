import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import uz from '../../../messages/uz.json';
import type * as ClientApiModule from '@/lib/client-api';
import { ClientApiError } from '@/lib/client-api';
import { TELEGRAM_WIDGET_SRC } from '@/lib/telegram-widget';
import { LoginForm } from './login-form';
import { TelegramLink } from '@/components/account/telegram-link';

const mocks = vi.hoisted(() => ({
  telegram: vi.fn(),
  linkTelegram: vi.fn(),
  replace: vi.fn(),
  routerRefresh: vi.fn(),
  nextRefresh: vi.fn(),
  cartRefresh: vi.fn(async () => undefined),
  merge: vi.fn(async () => undefined),
  toast: vi.fn(),
}));

vi.mock('@/lib/client-api', async (orig) => {
  const actual = await orig<typeof ClientApiModule>();
  return {
    ...actual,
    clientApi: {
      ...actual.clientApi,
      auth: { ...actual.clientApi.auth, telegram: mocks.telegram },
      me: { ...actual.clientApi.me, linkTelegram: mocks.linkTelegram },
    },
  };
});
// Run idle work immediately: the widget script is injected on idle in the browser.
vi.mock('@/lib/idle', () => ({
  onIdle: (fn: () => void) => {
    fn();
    return () => undefined;
  },
}));
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ replace: mocks.replace, refresh: mocks.routerRefresh }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.nextRefresh }),
  useParams: () => ({ locale: 'uz' }),
}));
vi.mock('@/components/cart/cart-provider', () => ({
  useCart: () => ({ refresh: mocks.cartRefresh }),
}));
vi.mock('@/lib/favourites', () => ({ mergeLocalFavourites: mocks.merge }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => mocks.toast }));

const BOT = 'forest_shop_bot';
const PAYLOAD = {
  id: 123456789,
  first_name: 'Dilnoza',
  username: 'dilnoza_uz',
  auth_date: 1_793_000_000,
  hash: 'a'.repeat(64),
};

function wrap(children: ReactNode) {
  return (
    <NextIntlClientProvider locale="uz" messages={uz} timeZone="Asia/Tashkent">
      {children}
    </NextIntlClientProvider>
  );
}

function widgetScript(): HTMLScriptElement {
  const s = document.querySelector<HTMLScriptElement>('script[data-telegram-login]');
  if (!s) throw new Error('widget script not injected');
  return s;
}

/** Plays the official widget: script loaded, then the user confirms in Telegram → `onauth`. */
async function telegramConfirms(payload: Record<string, string | number> = PAYLOAD) {
  const script = widgetScript();
  await act(async () => {
    script.onload?.(new Event('load'));
  });
  const fn = /^(\w+)\(user\)$/.exec(script.getAttribute('data-onauth') ?? '')?.[1];
  const cb = (window as unknown as Record<string, (u: unknown) => void>)[fn ?? ''];
  expect(typeof cb).toBe('function');
  await act(async () => {
    cb!(payload);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => cleanup());

describe('Telegram login on /kirish', () => {
  it('renders nothing Telegram-related when the API has no bot', () => {
    render(wrap(<LoginForm next="/kabinet" telegramBot={null} />));
    expect(screen.queryByTestId('telegram-login')).toBeNull();
    expect(document.querySelector('script[data-telegram-login]')).toBeNull();
    expect(screen.queryByText('yoki')).toBeNull();
  });

  it('injects the official widget with an onauth callback (no redirect mode)', () => {
    render(wrap(<LoginForm next="/kabinet" telegramBot={BOT} />));
    const s = widgetScript();
    expect(s.src).toBe(TELEGRAM_WIDGET_SRC);
    expect(s.getAttribute('data-telegram-login')).toBe(BOT);
    expect(s.getAttribute('data-onauth')).toMatch(/^__frTelegramAuth\d+\(user\)$/);
    expect(s.hasAttribute('data-auth-url')).toBe(false);
    expect(s.getAttribute('data-lang')).toBe('uz');
    // Placeholder in the design's place until the iframe is ready.
    expect(screen.getByRole('button', { name: 'Telegram orqali kirish' })).toBeTruthy();
  });

  it('onauth → POST /auth/telegram with the payload → favourites, cart, safe next', async () => {
    mocks.telegram.mockResolvedValue({ id: 'c1', phone: null });
    render(wrap(<LoginForm next="/buyurtma/pub123" telegramBot={BOT} />));
    await telegramConfirms();
    expect(screen.queryByRole('button', { name: 'Telegram orqali kirish' })).toBeNull();
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/buyurtma/pub123'));
    expect(mocks.telegram).toHaveBeenCalledWith(PAYLOAD);
    expect(mocks.merge).toHaveBeenCalled();
    expect(mocks.cartRefresh).toHaveBeenCalled();
    expect(mocks.routerRefresh).toHaveBeenCalled();
  });

  it.each([
    ['TELEGRAM_AUTH_EXPIRED', 401, "Telegram ma'lumotlari eskirgan."],
    ['TELEGRAM_AUTH_INVALID', 401, "Telegram orqali kirishni tasdiqlab bo'lmadi."],
    ['RATE_LIMITED', 429, "So'rovlar ko'p."],
    ['INTEGRATION_NOT_CONFIGURED', 503, 'Xizmat hali ulanmagan.'],
  ])('shows the API message for %s and stays on the page', async (code, status, message) => {
    mocks.telegram.mockRejectedValue(new ClientApiError(status, code, message));
    render(wrap(<LoginForm next="/kabinet" telegramBot={BOT} />));
    await telegramConfirms();
    await waitFor(() => expect(screen.getByTestId('telegram-error').textContent).toBe(message));
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it('hides server error details behind the generic message', async () => {
    mocks.telegram.mockRejectedValue(new ClientApiError(500, 'INTERNAL', 'stack trace'));
    render(wrap(<LoginForm next="/kabinet" telegramBot={BOT} />));
    await telegramConfirms();
    await waitFor(() =>
      expect(screen.getByTestId('telegram-error').textContent).toBe(uz.common.generic),
    );
  });

  it('explains when telegram.org cannot be reached; SMS login keeps working', async () => {
    render(wrap(<LoginForm next="/kabinet" telegramBot={BOT} />));
    await act(async () => {
      widgetScript().onerror?.(new Event('error'));
    });
    expect(screen.getByTestId('telegram-error').textContent).toBe(uz.telegram.loadFailed);
    expect(screen.getByTestId('login-send')).toBeTruthy();
  });

  it('ignores an invalid bot username', () => {
    render(wrap(<LoginForm next="/kabinet" telegramBot="bad name!" />));
    expect(screen.queryByTestId('telegram-login')).toBeNull();
    expect(document.querySelector('script[data-telegram-login]')).toBeNull();
  });

  it('loads the widget on first interaction when idle has not fired yet', async () => {
    const idle = await import('@/lib/idle');
    const spy = vi.spyOn(idle, 'onIdle').mockImplementation(() => () => undefined);
    render(wrap(<LoginForm next="/kabinet" telegramBot={BOT} />));
    expect(document.querySelector('script[data-telegram-login]')).toBeNull();
    fireEvent.focus(screen.getByRole('button', { name: 'Telegram orqali kirish' }));
    expect(widgetScript()).toBeTruthy();
    spy.mockRestore();
  });
});

describe('Telegram link in Kabinet → Sozlamalar', () => {
  it('shows the linked @username and no widget', () => {
    render(wrap(<TelegramLink telegram={{ username: 'dilnoza_uz' }} bot={BOT} />));
    expect(screen.getByTestId('telegram-username').textContent).toBe('@dilnoza_uz');
    expect(document.querySelector('script[data-telegram-login]')).toBeNull();
  });

  it('is hidden when nothing is linked and the API has no bot', () => {
    render(wrap(<TelegramLink telegram={null} bot={null} />));
    expect(screen.queryByTestId('telegram-link')).toBeNull();
  });

  it('links via POST /me/telegram/link and refreshes the page', async () => {
    mocks.linkTelegram.mockResolvedValue({ id: 'c1', telegram: { username: 'dilnoza_uz' } });
    render(wrap(<TelegramLink telegram={null} bot={BOT} />));
    expect(screen.getByRole('button', { name: "Telegram'ni bog'lash" })).toBeTruthy();
    await telegramConfirms();
    await waitFor(() => expect(mocks.nextRefresh).toHaveBeenCalled());
    expect(mocks.linkTelegram).toHaveBeenCalledWith(PAYLOAD);
    expect(mocks.telegram).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith(uz.account.telegramDone, 'good');
  });

  it('shows TELEGRAM_ALREADY_LINKED from the API', async () => {
    const msg = "Bu Telegram akkaunt boshqa mijozga ulangan. Operator bilan bog'laning.";
    mocks.linkTelegram.mockRejectedValue(new ClientApiError(409, 'TELEGRAM_ALREADY_LINKED', msg));
    render(wrap(<TelegramLink telegram={null} bot={BOT} />));
    await telegramConfirms();
    await waitFor(() => expect(screen.getByTestId('telegram-error').textContent).toBe(msg));
    expect(mocks.nextRefresh).not.toHaveBeenCalled();
  });
});
