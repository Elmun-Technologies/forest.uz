import {
  isCheckoutPath,
  type ReplayGateConfig,
  type ReplayReason,
  replayReason,
} from '@forest/contracts/core';
import { readConsent } from './consent';

/**
 * Session replay gate (CLAUDE.md §6): decides whether this tab records the current tracker
 * session and only then injects `/r.js` (rrweb, ~60 KB gzip). Nothing is downloaded for visitors
 * without recording consent or outside the sample.
 */

/** sessionStorage: the session id that reached checkout in this tab. */
const CHECKOUT_KEY = 'fr_rpc';
/** The tracker loads after idle; stop waiting for it after this long. */
const TRACKER_WAIT_MS = 30_000;
const TRACKER_POLL_MS = 1_000;

interface TrackerHook {
  sessionId(): string | null;
  onSession(fn: (sessionId: string) => void): () => void;
  onConsent(fn: (c: unknown) => void): () => void;
}

interface RecorderApi {
  sessionId(): string | null;
  start(sessionId: string, reason: ReplayReason): void;
}

export interface RecorderBoot {
  sessionId: string;
  reason: ReplayReason;
  config: ReplayGateConfig;
  checkout: (sessionId: string) => boolean;
}

type GateWindow = Window & {
  __forestTracker?: TrackerHook;
  __forestReplay?: RecorderApi;
  __forestReplayBoot?: RecorderBoot;
};

export function checkoutReached(sessionId: string): boolean {
  try {
    return sessionStorage.getItem(CHECKOUT_KEY) === sessionId;
  } catch {
    return false;
  }
}

function markCheckout(sessionId: string): void {
  try {
    sessionStorage.setItem(CHECKOUT_KEY, sessionId);
  } catch {
    // Private mode: checkout sampling then only applies to this page view.
  }
}

/** Consent for recording: explicit `replay`, and analytics not refused. */
export function recordingConsented(): boolean {
  const c = readConsent();
  return !!c && c.analytics !== false && c.replay === true;
}

let config: ReplayGateConfig | null = null;
let version = '';
let subscribed = false;
let injected = false;
let waitedMs = 0;
let waitTimer: number | undefined;

function decide(win: GateWindow, sessionId: string | null, path: string): void {
  if (!config || !sessionId || !recordingConsented()) return;
  if (typeof CompressionStream !== 'function') return;
  const onCheckout = isCheckoutPath(path);
  if (onCheckout) markCheckout(sessionId);
  const reason = replayReason({
    sessionId,
    config,
    checkout: onCheckout || checkoutReached(sessionId),
  });
  if (!reason) return;
  const recorder = win.__forestReplay;
  if (recorder) {
    if (recorder.sessionId() !== sessionId) recorder.start(sessionId, reason);
    return;
  }
  if (injected) return;
  injected = true;
  win.__forestReplayBoot = { sessionId, reason, config, checkout: checkoutReached };
  const script = win.document.createElement('script');
  script.src = `/r.js?v=${encodeURIComponent(version)}`;
  script.async = true;
  win.document.head.appendChild(script);
}

/**
 * Called on idle after every route change with the public replay settings. Waits for the tracker
 * (`window.__forestTracker`, packages/tracker README) and follows its session/consent changes.
 */
export function runReplayGate(
  win: GateWindow,
  next: ReplayGateConfig,
  recorderVersion: string,
): void {
  config = next;
  version = recorderVersion;
  if (!config.enabled) return;
  const tracker = win.__forestTracker;
  if (!tracker) {
    if (waitTimer !== undefined || waitedMs >= TRACKER_WAIT_MS) return;
    waitTimer = win.setTimeout(() => {
      waitTimer = undefined;
      waitedMs += TRACKER_POLL_MS;
      runReplayGate(win, next, recorderVersion);
    }, TRACKER_POLL_MS);
    return;
  }
  if (!subscribed) {
    subscribed = true;
    tracker.onSession((sid) => decide(win, sid, win.location.pathname));
    tracker.onConsent(() => decide(win, tracker.sessionId(), win.location.pathname));
  }
  decide(win, tracker.sessionId(), win.location.pathname);
}
