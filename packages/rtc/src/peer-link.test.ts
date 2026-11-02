import { afterEach, describe, expect, it, vi } from 'vitest';
import { PeerLink, type PeerLinkOptions } from './peer-link';
import type { PortMapper } from './port-mapping';

/** Just enough of a connection to drive the signaling: applying a description takes a moment, and the state changes when it is done. */
class FakeConnection {
  signalingState: RTCSignalingState = 'stable';
  localDescription = { toJSON: () => ({ type: 'answer', sdp: 'x' }) };
  applied: string[] = [];
  onicecandidate: unknown;
  ontrack: unknown;
  onnegotiationneeded: unknown;
  oniceconnectionstatechange: unknown;
  stats = new Map<string, Record<string, unknown>>();
  getStats = async () => this.stats;
  addTrack = vi.fn();
  getSenders = () => [];
  getTransceivers = () => [];
  createDataChannel = () => ({ close() {} });
  close() {}
  async setRemoteDescription(description: { type: string }) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    this.applied.push(description.type);
    this.signalingState = description.type === 'answer' ? 'stable' : 'have-remote-offer';
  }
  async setLocalDescription() {
    this.signalingState = 'stable';
  }
}

let connection: FakeConnection;
const link = (selfId: string, id: string, options?: PeerLinkOptions) => {
  vi.stubGlobal('RTCPeerConnection', function () {
    connection = new FakeConnection();
    return connection;
  });
  const hooks = { signal: vi.fn(), stream: vi.fn(), message: vi.fn(), state: vi.fn(), route: vi.fn(), channelOpen: vi.fn() };
  const local = { getTracks: () => [] } as unknown as MediaStream;
  return { link: new PeerLink(id, selfId, {}, local, hooks, true, options), hooks };
};

afterEach(() => vi.unstubAllGlobals());

describe('PeerLink signaling', () => {
  // `b` is not below `a`, so it is the impolite peer: it ignores an offer that collides with its own.
  it('applies an offer that arrives while the answer before it is still being applied', async () => {
    const { link: peer, hooks } = link('b', 'a');
    connection.signalingState = 'have-local-offer'; // our offer is out; the answer and then a second offer follow at once
    await Promise.all([
      peer.handleSignal({ description: { type: 'answer', sdp: 'x' } }),
      peer.handleSignal({ description: { type: 'offer', sdp: 'y' } }),
    ]);
    expect(connection.applied).toEqual(['answer', 'offer']);
    expect(hooks.signal).toHaveBeenCalled(); // and it was answered
    peer.close();
  });

  it('still ignores an offer that collides with its own while no answer is arriving', async () => {
    const { link: peer } = link('b', 'a');
    connection.signalingState = 'have-local-offer';
    await peer.handleSignal({ description: { type: 'offer', sdp: 'y' } });
    expect(connection.applied).toEqual([]);
    peer.close();
  });

  it('takes an offer when nothing is pending', async () => {
    const { link: peer } = link('b', 'a');
    await peer.handleSignal({ description: { type: 'offer', sdp: 'y' } });
    expect(connection.applied).toEqual(['offer']);
    peer.close();
  });
});

/** The browser finding one of our candidates. */
const gather = (line: string) => {
  const json = { candidate: line, sdpMid: '0', sdpMLineIndex: 0, usernameFragment: 'uf' };
  (connection.onicecandidate as (e: { candidate: unknown }) => void)({ candidate: { toJSON: () => json } });
};
const HOST = 'candidate:1 1 udp 2122260223 192.168.1.20 50000 typ host generation 0';
const sentCandidates = (signal: ReturnType<typeof vi.fn>) =>
  signal.mock.calls.map(([payload]) => (payload as { candidate?: RTCIceCandidateInit }).candidate?.candidate);
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function fakeMapper(result: Promise<{ externalIp: string; externalPort: number }> = Promise.resolve({ externalIp: '203.0.113.7', externalPort: 50000 })) {
  return { map: vi.fn(() => result), unmap: vi.fn(async () => {}) } satisfies PortMapper;
}

describe('PeerLink port mapping', () => {
  it('tells the other peer the router address of a forwarded port, after the local candidate', async () => {
    const mapper = fakeMapper();
    const { link: peer, hooks } = link('b', 'a', { portMapper: mapper });
    gather(HOST);
    await settle();
    expect(mapper.map).toHaveBeenCalledWith('192.168.1.20', 50000);
    const [local, mapped] = hooks.signal.mock.calls.map(([payload]) => payload.candidate);
    expect(local.candidate).toBe(HOST);
    expect(mapped).toMatchObject({ sdpMid: '0', sdpMLineIndex: 0, usernameFragment: 'uf' });
    expect(mapped.candidate).toMatch(/ udp \d+ 203\.0\.113\.7 50000 typ srflx raddr 192\.168\.1\.20 rport 50000$/);
    peer.close();
  });

  it('releases what it forwarded when the connection closes', async () => {
    const mapper = fakeMapper();
    const { link: peer } = link('b', 'a', { portMapper: mapper });
    gather(HOST);
    await settle();
    peer.close();
    expect(mapper.unmap).toHaveBeenCalledWith('192.168.1.20', 50000);
  });

  it('asks only once for a port it sees again', async () => {
    const mapper = fakeMapper();
    const { link: peer } = link('b', 'a', { portMapper: mapper });
    gather(HOST);
    gather(HOST);
    await settle();
    expect(mapper.map).toHaveBeenCalledTimes(1);
    peer.close();
  });

  it('does not offer a router port the internet cannot reach, when the router is behind another NAT', async () => {
    const mapper = fakeMapper();
    const { link: peer, hooks } = link('b', 'a', { portMapper: mapper });
    gather('candidate:2 1 udp 1686052607 198.51.100.4 61000 typ srflx raddr 192.168.1.20 rport 50000');
    gather(HOST);
    await settle();
    expect(sentCandidates(hooks.signal)).toHaveLength(2); // only the two the browser found
    expect(mapper.unmap).toHaveBeenCalledWith('192.168.1.20', 50000);
    peer.close();
  });

  it('carries on without a mapping when there is no router to give one', async () => {
    const mapper = fakeMapper(Promise.reject(new Error('no router')));
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    const { link: peer, hooks } = link('b', 'a', { portMapper: mapper });
    gather(HOST);
    await settle();
    expect(sentCandidates(hooks.signal)).toEqual([HOST]);
    peer.close();
  });

  it('asks for nothing without a mapper, as in a browser', async () => {
    const { link: peer, hooks } = link('b', 'a');
    gather(HOST);
    await settle();
    expect(sentCandidates(hooks.signal)).toEqual([HOST]);
    peer.close();
  });

  it('knows when the connection in use runs through the forwarded port, and not for someone on the same network', async () => {
    const { link: peer } = link('b', 'a', { portMapper: fakeMapper() });
    gather(HOST);
    await settle();
    const select = (remote: string) => {
      connection.stats = new Map(
        Object.entries({
          t: { type: 'transport', selectedCandidatePairId: 'p' },
          p: { type: 'candidate-pair', localCandidateId: 'l', remoteCandidateId: 'r' },
          l: { type: 'local-candidate', candidateType: 'host', address: '192.168.1.20', port: 50000 },
          r: { type: 'remote-candidate', candidateType: 'prflx', address: remote, port: 40000 },
        }),
      );
    };
    select('198.51.100.9');
    await peer.detectRoute();
    expect(peer.viaPortMapping).toBe(true);
    select('192.168.1.30');
    await peer.detectRoute();
    expect(peer.viaPortMapping).toBe(false);
    peer.close();
  });
});
