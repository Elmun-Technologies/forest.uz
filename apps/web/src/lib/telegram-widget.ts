/**
 * Official Telegram Login Widget (core.telegram.org/widgets/login). The script turns its own
 * `<script data-telegram-login>` tag into a cross-origin iframe button; with `data-onauth` it
 * calls a global function with the signed user object instead of redirecting.
 * Loaded only by `TelegramLogin` (login page, cabinet settings) — never globally (CLAUDE.md §6).
 */
export const TELEGRAM_WIDGET_SRC = 'https://telegram.org/js/telegram-widget.js?22';

/** Signed widget payload (`id, first_name, last_name, username, photo_url, auth_date, hash`). */
export type TelegramAuthPayload = Record<string, string | number>;

/** Bot usernames are 5–32 latin letters, digits and underscores. */
export const isBotUsername = (v: string) => /^[A-Za-z0-9_]{5,32}$/.test(v);

let seq = 0;

/**
 * Injects the widget script into `slot` (an element React renders without children) and wires a
 * unique global `onauth` callback. Returns a cleanup that removes the iframe and the callback.
 */
export function mountTelegramWidget(
  slot: HTMLElement,
  opts: {
    bot: string;
    lang: string;
    onAuth: (user: TelegramAuthPayload) => void;
    onLoad?: () => void;
    onError?: () => void;
  },
): () => void {
  const callback = `__frTelegramAuth${++seq}`;
  const w = window as unknown as Record<string, unknown>;
  w[callback] = (user: unknown) => {
    if (user && typeof user === 'object') opts.onAuth(user as TelegramAuthPayload);
  };
  const script = document.createElement('script');
  script.async = true;
  script.src = TELEGRAM_WIDGET_SRC;
  script.setAttribute('data-telegram-login', opts.bot);
  script.setAttribute('data-size', 'large');
  script.setAttribute('data-radius', '999');
  script.setAttribute('data-userpic', 'false');
  script.setAttribute('data-lang', opts.lang);
  // The widget evaluates this expression with `user` bound to the signed payload.
  script.setAttribute('data-onauth', `${callback}(user)`);
  script.onload = () => opts.onLoad?.();
  script.onerror = () => opts.onError?.();
  slot.appendChild(script);
  return () => {
    delete w[callback];
    slot.replaceChildren();
  };
}
