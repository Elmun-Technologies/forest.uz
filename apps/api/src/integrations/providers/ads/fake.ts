import { randomUUID } from 'node:crypto';
import type { AdDestination, AdSignalPlatform } from '@forest/contracts';
import {
  type AdConversion,
  AdPlatformError,
  type AudienceListProvider,
  type ConversionProvider,
  type ConversionSendResult,
  emptyResult,
  hashPhone,
} from './types';

/**
 * In-memory ad platforms for `PROVIDERS_MODE=fake` (dev, CI, integration tests). They keep what a
 * real platform would hold so tests can assert uploads/removals and sent events; no network.
 */
export class FakeAdsState {
  /** destination → audience id → hashes. */
  readonly audiences = new Map<AdDestination, Map<string, Set<string>>>();
  /** platform → event ids accepted (a re-send of the same id is deduped like the platforms do). */
  readonly events = new Map<AdSignalPlatform, Map<string, AdConversion>>();
  /** Calls made, for assertions ("nothing was sent"). */
  readonly calls: { target: string; op: string; count: number }[] = [];
  /** Event ids the fake platform rejects (failure/backoff tests). */
  readonly rejectEvents = new Set<string>();
  /** When set, every audience call fails with this message. */
  audienceError: string | null = null;

  reset(): void {
    this.audiences.clear();
    this.events.clear();
    this.calls.length = 0;
    this.rejectEvents.clear();
    this.audienceError = null;
  }
}

export class FakeAudienceProvider implements AudienceListProvider {
  constructor(
    readonly destination: AdDestination,
    private readonly state: FakeAdsState,
  ) {}

  private lists(): Map<string, Set<string>> {
    let m = this.state.audiences.get(this.destination);
    if (!m) {
      m = new Map();
      this.state.audiences.set(this.destination, m);
    }
    return m;
  }

  private guard(op: string, count: number) {
    this.state.calls.push({ target: this.destination, op, count });
    if (this.state.audienceError) throw new AdPlatformError(this.state.audienceError);
  }

  async create(_name: string, hashes: string[]): Promise<string> {
    this.guard('create', hashes.length);
    const id = `fake-${this.destination}-${randomUUID().slice(0, 8)}`;
    this.lists().set(id, new Set(hashes));
    return id;
  }

  async add(id: string, hashes: string[]): Promise<void> {
    this.guard('add', hashes.length);
    const list = this.lists().get(id) ?? new Set<string>();
    for (const h of hashes) list.add(h);
    this.lists().set(id, list);
  }

  async remove(id: string, hashes: string[]): Promise<void> {
    this.guard('remove', hashes.length);
    const list = this.lists().get(id);
    for (const h of hashes) list?.delete(h);
  }
}

export class FakeConversionProvider implements ConversionProvider {
  constructor(
    readonly platform: AdSignalPlatform,
    private readonly state: FakeAdsState,
  ) {}

  async send(events: AdConversion[]): Promise<ConversionSendResult> {
    this.state.calls.push({ target: this.platform, op: 'send', count: events.length });
    const result = emptyResult();
    let accepted = this.state.events.get(this.platform);
    if (!accepted) {
      accepted = new Map();
      this.state.events.set(this.platform, accepted);
    }
    for (const e of events) {
      // Same identifier rule as the real adapters: something to match on is required.
      const id = e.phone ? hashPhone(e.phone, this.platform) : null;
      const click =
        this.platform === 'meta'
          ? e.clickIds.fbclid
          : this.platform === 'google'
            ? e.clickIds.gclid
            : e.clickIds.ttclid;
      if (!id && !click && !(this.platform !== 'google' && e.customerId))
        result.skipped.set(e.eventId, 'no user identifiers');
      else if (this.state.rejectEvents.has(e.eventId)) result.failed.set(e.eventId, 'fake reject');
      else accepted.set(e.eventId, e);
    }
    return result;
  }
}
