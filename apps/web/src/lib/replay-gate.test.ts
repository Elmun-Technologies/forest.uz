import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const SID = '0192f0e1-0000-7abc-8def-0123456789ab';

function setConsent(replay: boolean | undefined) {
  const v = {
    v: 1,
    analytics: true,
    marketing: false,
    ts: 1,
    ...(replay === undefined ? {} : { replay }),
  };
  document.cookie = `fr_consent=${encodeURIComponent(JSON.stringify(v))}; path=/`;
}

function fakeTracker(sid: string) {
  const sessionFns: ((s: string) => void)[] = [];
  const api = {
    sessionId: () => sid,
    onSession(fn: (s: string) => void) {
      sessionFns.push(fn);
      fn(sid);
      return () => undefined;
    },
    onConsent: () => () => undefined,
  };
  (window as unknown as { __forestTracker: typeof api }).__forestTracker = api;
  return api;
}

const scripts = () =>
  Array.from(document.head.querySelectorAll('script')).map((s) => s.getAttribute('src'));
const boot = () =>
  (window as unknown as { __forestReplayBoot?: { sessionId: string; reason: string } })
    .__forestReplayBoot;

async function gate() {
  vi.resetModules();
  return (await import('./replay-gate')).runReplayGate;
}

describe('replay gate', () => {
  beforeEach(() => {
    (globalThis as { CompressionStream?: unknown }).CompressionStream ??= class {};
    document.head.innerHTML = '';
    sessionStorage.clear();
    window.history.replaceState(null, '', '/uz');
    delete (window as { __forestReplayBoot?: unknown }).__forestReplayBoot;
  });
  afterEach(() => {
    document.cookie = 'fr_consent=; max-age=0; path=/';
  });

  it('loads nothing without recording consent (absent = no)', async () => {
    setConsent(undefined);
    fakeTracker(SID);
    (await gate())(window, { enabled: true, samplePct: 100, checkoutPct: 100 }, 'v1');
    expect(scripts()).toEqual([]);
  });

  it('loads /r.js for a consented, sampled session', async () => {
    setConsent(true);
    fakeTracker(SID);
    (await gate())(window, { enabled: true, samplePct: 100, checkoutPct: 100 }, 'abc');
    expect(scripts()).toEqual(['/r.js?v=abc']);
    expect(boot()).toMatchObject({ sessionId: SID, reason: 'sample' });
  });

  it('kill switch off → nothing', async () => {
    setConsent(true);
    fakeTracker(SID);
    (await gate())(window, { enabled: false, samplePct: 100, checkoutPct: 100 }, 'abc');
    expect(scripts()).toEqual([]);
  });

  it('outside the sample, recording starts once the session reaches checkout', async () => {
    setConsent(true);
    fakeTracker(SID);
    const run = await gate();
    const config = { enabled: true, samplePct: 0, checkoutPct: 100 };
    run(window, config, 'abc');
    expect(scripts()).toEqual([]);
    window.history.replaceState(null, '', '/uz/checkout');
    run(window, config, 'abc');
    expect(scripts()).toEqual(['/r.js?v=abc']);
    expect(boot()).toMatchObject({ sessionId: SID, reason: 'checkout' });
    expect(sessionStorage.getItem('fr_rpc')).toBe(SID);
  });
});
