import { record } from 'rrweb';
import {
  REPLAY_LIMITS,
  type ReplayGateConfig,
  type ReplayReason,
  replayReason,
  scrubReplayEvent,
} from '@forest/contracts/core';
import { RECORD_OPTIONS } from './options';

/**
 * Session replay recorder (`/r.js`, docs/07): rrweb with every input masked, `[data-private]`
 * text masked, no canvas/network/console. Loaded by the storefront's replay gate only for a
 * consented, sampled session; it uploads gzip chunks every 10 s to `POST /api/t/replay`.
 */

export const ENDPOINT = '/api/t/replay';
/** Chunks kept while the API doesn't know the session yet (ingest lag); beyond → give up. */
const MAX_PENDING_EVENTS = 20_000;

type RecordedEvent = { timestamp: number; type: number };

/** Set by the gate before it injects the script. */
export interface RecorderBoot {
  sessionId: string;
  reason: ReplayReason;
  config: ReplayGateConfig;
  /** True once the session reached checkout in this tab. */
  checkout: (sessionId: string) => boolean;
}

interface TrackerHook {
  onSession(fn: (sessionId: string) => void): () => void;
  onConsent(fn: (c: { analytics: boolean; replay?: boolean }) => void): () => void;
}

/** `window.__forestReplay` once the script runs (the gate talks to it). */
export interface RecorderApi {
  /** The session being recorded, or null. */
  sessionId(): string | null;
  /** Starts recording `sessionId` unless it already is (e.g. the session reached checkout). */
  start(sessionId: string, reason: ReplayReason): void;
  stop(): void;
}

type Win = Window &
  typeof globalThis & {
    __forestReplayBoot?: RecorderBoot;
    __forestReplay?: RecorderApi;
    __forestTracker?: TrackerHook;
  };

async function gzip(text: string): Promise<Blob> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Response(stream).blob();
}

export function startRecorder(win: Win, boot: RecorderBoot): void {
  let sid: string | null = boot.sessionId;
  let reason: ReplayReason = boot.reason;
  let buffer: RecordedEvent[] = [];
  let stopRecording: (() => void) | undefined;
  let dead = false;

  const begin = () => {
    stopRecording =
      record({
        ...RECORD_OPTIONS,
        // Page URL and link/form URLs lose query strings and capability tokens (`/t/<token>`)
        // before they leave the browser; a copy, so rrweb's own node records stay untouched.
        emit: (e) => {
          const ev = e as RecordedEvent;
          buffer.push(ev.type >= 2 && ev.type <= 4 ? scrubReplayEvent(structuredClone(ev)) : ev);
        },
      }) ?? undefined;
  };

  const halt = () => {
    stopRecording?.();
    stopRecording = undefined;
  };

  async function send(
    forSid: string,
    why: ReplayReason,
    events: RecordedEvent[],
    keepalive: boolean,
  ) {
    let requeue = false;
    try {
      const body = await gzip(JSON.stringify(events));
      const res = await fetch(`${ENDPOINT}?sid=${encodeURIComponent(forSid)}&reason=${why}`, {
        method: 'POST',
        body,
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-Replay-Now': String(Date.now()),
        },
        credentials: 'same-origin',
        // keepalive bodies are capped at 64 KB by browsers.
        keepalive: keepalive && body.size < 60_000,
      });
      // 409: the API doesn't know the session yet (ingest lag) → retry with the next chunk.
      if (res.status === 409 || res.status === 429 || res.status >= 500) requeue = true;
      // 403 (consent/sample/session mismatch) or 413 (session cap): this session is done.
      else if ((res.status === 403 || res.status === 413) && forSid === sid) {
        halt();
        buffer = [];
        sid = null;
      }
    } catch {
      requeue = true;
    }
    if (requeue && forSid === sid) {
      buffer = events.concat(buffer);
      if (buffer.length > MAX_PENDING_EVENTS) {
        halt();
        buffer = [];
        sid = null;
      }
    }
  }

  /** Takes the buffer synchronously (so a session switch right after can't mix chunks). */
  function flush(keepalive = false): void {
    if (!sid || buffer.length === 0) return;
    const events = buffer;
    buffer = [];
    void send(sid, reason, events, keepalive);
  }

  const timer = win.setInterval(() => flush(), REPLAY_LIMITS.flushMs);
  win.document.addEventListener('visibilitychange', () => {
    if (win.document.visibilityState === 'hidden') flush(true);
  });
  win.addEventListener('pagehide', () => flush(true));

  const stopAll = () => {
    dead = true;
    halt();
    buffer = [];
    sid = null;
    win.clearInterval(timer);
  };

  const tracker = win.__forestTracker;
  // A new tracker session (30 min idle, new campaign) gets its own decision and full snapshot.
  tracker?.onSession((next) => {
    if (dead || next === sid) return;
    flush(true);
    halt();
    buffer = [];
    const r = replayReason({
      sessionId: next,
      config: boot.config,
      checkout: boot.checkout(next),
    });
    sid = r ? next : null;
    if (r) {
      reason = r;
      begin();
    }
  });
  // Consent withdrawn → stop at once and drop what is not sent.
  tracker?.onConsent((c) => {
    if (c.analytics === false || c.replay !== true) stopAll();
  });

  win.__forestReplay = {
    sessionId: () => sid,
    start(next, why) {
      if (dead || (sid === next && stopRecording)) return;
      flush(true);
      halt();
      buffer = [];
      sid = next;
      reason = why;
      begin();
    },
    stop: stopAll,
  };
  begin();
}

const w = (typeof window === 'undefined' ? undefined : window) as Win | undefined;
if (w && w.__forestReplayBoot && !w.__forestReplay && typeof CompressionStream === 'function')
  startRecorder(w, w.__forestReplayBoot);
