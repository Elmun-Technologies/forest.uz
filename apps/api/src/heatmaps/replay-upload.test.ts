import { ipBucket } from './replay-upload.service';

describe('replay rate-limit identity', () => {
  it('keeps IPv4, maps IPv4-mapped IPv6, and buckets IPv6 by /64', () => {
    expect(ipBucket('10.1.2.3')).toBe('10.1.2.3');
    expect(ipBucket('::ffff:192.168.1.7')).toBe('192.168.1.7');
    expect(ipBucket('2001:db8:85a3:0042:1000:8a2e:370:7334')).toBe('2001:db8:85a3:42::/64');
    expect(ipBucket('2001:db8:85a3:42::1')).toBe('2001:db8:85a3:42::/64');
    expect(ipBucket('2001:DB8::1')).toBe('2001:db8:0:0::/64');
    expect(ipBucket('2001:db8::1')).toBe(ipBucket('2001:db8:0:0:ffff::2'));
  });
});
