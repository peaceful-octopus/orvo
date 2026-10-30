import { afterEach, describe, expect, it, vi } from 'vitest';
import { PeerLink } from './peer-link';

/** Just enough of a connection to drive the signaling: applying a description takes a moment, and the state changes when it is done. */
class FakeConnection {
  signalingState: RTCSignalingState = 'stable';
  localDescription = { toJSON: () => ({ type: 'answer', sdp: 'x' }) };
  applied: string[] = [];
  onicecandidate: unknown;
  ontrack: unknown;
  onnegotiationneeded: unknown;
  oniceconnectionstatechange: unknown;
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
const link = (selfId: string, id: string) => {
  vi.stubGlobal('RTCPeerConnection', function () {
    connection = new FakeConnection();
    return connection;
  });
  const hooks = { signal: vi.fn(), stream: vi.fn(), message: vi.fn(), state: vi.fn(), route: vi.fn(), channelOpen: vi.fn() };
  const local = { getTracks: () => [] } as unknown as MediaStream;
  return { link: new PeerLink(id, selfId, {}, local, hooks, true), hooks };
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
