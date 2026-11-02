import { describe, expect, it } from 'vitest';
import { canMap, isPrivateIpv4, parseCandidate } from './port-mapping';

describe('parseCandidate', () => {
  it('reads the fields of a candidate line, with or without the SDP prefix', () => {
    const line = 'candidate:842163049 1 udp 1677729535 198.51.100.4 61000 typ srflx raddr 192.168.1.20 rport 50000';
    const parsed = { foundation: '842163049', component: 1, protocol: 'udp', address: '198.51.100.4', port: 61000, type: 'srflx' };
    expect(parseCandidate(line)).toEqual(parsed);
    expect(parseCandidate(`a=${line}`)).toEqual(parsed);
  });

  it('rejects what is not a candidate line', () => {
    expect(parseCandidate('')).toBeUndefined();
    expect(parseCandidate('candidate:1 1 udp 1 1.2.3.4 x typ host')).toBeUndefined();
  });
});

describe('canMap', () => {
  const candidate = (address: string, rest = 'udp', type = 'host') => parseCandidate(`candidate:1 1 ${rest} 1 ${address} 50000 typ ${type}`)!;

  it('takes our UDP addresses on a private network', () => {
    for (const ip of ['10.0.0.5', '172.20.1.1', '192.168.1.20']) expect(canMap(candidate(ip))).toBe(true);
  });

  it('leaves out what a router cannot forward to', () => {
    expect(canMap(candidate('3f0c2c1e-5e3a-4b0e-9c33-3d2f7c8d9a10.local'))).toBe(false); // hidden without media permission
    expect(canMap(candidate('2001:db8::1'))).toBe(false);
    expect(canMap(candidate('100.72.1.2'))).toBe(false); // a carrier-grade NAT address, not a home network
    expect(canMap(candidate('192.168.1.20', 'tcp'))).toBe(false);
    expect(canMap(candidate('192.168.1.20', 'udp', 'srflx'))).toBe(false);
  });
});

describe('isPrivateIpv4', () => {
  it('knows the private ranges and their edges', () => {
    expect(['10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.0.1'].map(isPrivateIpv4)).toEqual([true, true, true, true]);
    expect(['172.15.0.1', '172.32.0.1', '192.169.0.1', '8.8.8.8', '1.2.3', 'x'].map(isPrivateIpv4)).toEqual(Array(6).fill(false));
  });
});
