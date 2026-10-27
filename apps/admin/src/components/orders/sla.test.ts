import { describe, expect, it } from 'vitest';
import { slaDeadline, slaLeftShare, slaText } from './sla';

const now = new Date('2026-10-27T10:00:00Z'); // 15:00 Tashkent

describe('SLA texts (A6/A7)', () => {
  it('counts down in hours and minutes, then shows the delay', () => {
    expect(slaText('2026-10-27T16:18:30Z', now)).toBe('6 soat 18 daq qoldi');
    expect(slaText('2026-10-27T10:42:00Z', now)).toBe('42 daq qoldi');
    expect(slaText('2026-10-27T09:45:00Z', now)).toBe('Kechikmoqda · 15 daq');
  });

  it('deadline relative to Tashkent days', () => {
    expect(slaDeadline('2026-10-27T17:42:00Z', now)).toBe('bugun 22:42 gacha');
    expect(slaDeadline('2026-10-28T07:00:00Z', now)).toBe('ertaga 12:00 gacha');
    expect(slaDeadline('2026-10-30T07:00:00Z', now)).toBe('30.10 12:00 gacha');
  });

  it('share of the window left is clamped to 0…1', () => {
    expect(slaLeftShare('2026-10-27T04:00:00Z', '2026-10-27T16:00:00Z', now)).toBe(0.5);
    expect(slaLeftShare(null, '2026-10-27T09:00:00Z', now)).toBe(0);
  });
});
