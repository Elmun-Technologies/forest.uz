import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import uz from '../../../messages/uz.json';
import { LEAD_TIMER_MS } from '@/lib/lead-prompt';
import { LeadPopup } from './lead-popup';

const mocks = vi.hoisted(() => ({ pathname: '/' }));

vi.mock('@/i18n/navigation', () => ({
  usePathname: () => mocks.pathname,
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
// Resolve `next/dynamic` imports eagerly through React.lazy so the islands render in tests.
vi.mock('next/dynamic', async () => {
  const { lazy, Suspense, createElement } = await import('react');
  return {
    default: (loader: () => Promise<{ default: React.ComponentType<object> }>) => {
      const C = lazy(loader);
      return (props: object) =>
        createElement(Suspense, { fallback: null }, createElement(C, props));
    },
  };
});

function setViewport(lg: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: lg && (query.includes('min-width: 1024px') || query.includes('pointer: fine')),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
}

function consentAnswered() {
  const v = { v: 1, analytics: true, marketing: false, replay: false, ts: 1 };
  document.cookie = `fr_consent=${encodeURIComponent(JSON.stringify(v))}; path=/`;
}

function renderPopup() {
  return render(
    <NextIntlClientProvider locale="uz" messages={uz}>
      <LeadPopup telegramBot={null} before={null} after={null} fallback={null} />
    </NextIntlClientProvider>,
  );
}

async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
  // let React.lazy resolve
  await act(async () => {
    await Promise.resolve();
  });
}

describe('LeadPopup', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.pathname = '/';
    sessionStorage.clear();
    localStorage.clear();
    consentAnswered();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    document.cookie = 'fr_consent=; Max-Age=0; path=/';
  });

  it('phones: a non-modal bottom bar after the time trigger, whose CTA opens the form', async () => {
    setViewport(false);
    renderPopup();
    // Scrolling (the old fast scroll-up trigger) opens nothing on phones.
    await act(async () => {
      window.dispatchEvent(new Event('scroll'));
    });
    await advance(LEAD_TIMER_MS - 1);
    expect(screen.queryByTestId('lead-bar')).toBeNull();
    await advance(1);
    const bar = await vi.waitFor(() => screen.getByTestId('lead-bar'));
    expect(bar.textContent).toContain(uz.popup.barText);
    expect(screen.queryByTestId('lead-popup')).toBeNull();
    expect(sessionStorage.getItem('fr_popup_shown')).toBe('1');

    fireEvent.click(screen.getByRole('button', { name: uz.popup.barCta }));
    await vi.waitFor(() => screen.getByTestId('lead-popup'));
    expect(screen.queryByTestId('lead-bar')).toBeNull();
  });

  it('phones: × hides the bar', async () => {
    setViewport(false);
    renderPopup();
    await advance(LEAD_TIMER_MS);
    await vi.waitFor(() => screen.getByTestId('lead-bar'));
    fireEvent.click(screen.getByRole('button', { name: uz.common.close }));
    expect(screen.queryByTestId('lead-bar')).toBeNull();
  });

  it('phones: never on a product page, waits while the cookie banner is open', async () => {
    setViewport(false);
    mocks.pathname = '/p/chalk-white';
    renderPopup();
    await advance(LEAD_TIMER_MS * 2);
    expect(screen.queryByTestId('lead-bar')).toBeNull();
    expect(sessionStorage.getItem('fr_popup_shown')).toBeNull();
    cleanup();

    mocks.pathname = '/katalog';
    document.cookie = 'fr_consent=; Max-Age=0; path=/';
    renderPopup();
    await advance(LEAD_TIMER_MS);
    expect(screen.queryByTestId('lead-bar')).toBeNull();
    consentAnswered();
    await advance(LEAD_TIMER_MS);
    await vi.waitFor(() => screen.getByTestId('lead-bar'));
  });

  it('suppressed for visitors who already left a phone or saw it this session', async () => {
    setViewport(false);
    localStorage.setItem('fr_lead', '1');
    renderPopup();
    await advance(LEAD_TIMER_MS * 2);
    expect(screen.queryByTestId('lead-bar')).toBeNull();
  });

  it('desktop: the modal popup on exit intent, no time trigger', async () => {
    setViewport(true);
    renderPopup();
    await advance(LEAD_TIMER_MS * 2);
    expect(screen.queryByTestId('lead-popup')).toBeNull();
    await act(async () => {
      document.dispatchEvent(new MouseEvent('mouseout', { clientY: 0, relatedTarget: null }));
    });
    await vi.waitFor(() => screen.getByTestId('lead-popup'));
    expect(screen.queryByTestId('lead-bar')).toBeNull();
  });
});
