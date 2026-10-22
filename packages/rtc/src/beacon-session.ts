import { JoinResponse, PROTOCOL_VERSION } from '@chillcall/protocol';
import { JoinError, UpgradeRequiredError } from './transport';

export interface JoinParams {
  room: string;
  clientVersion: string;
  resume?: string;
  /** Reserved for a future billing service. */
  entitlement?: string;
}

/**
 * Asks beacons for a signaling node, in preference order. A beacon that is unreachable or failing
 * (network error, 5xx) is skipped in favor of the next; a definite answer from a beacon, such as
 * "update required", is final.
 */
export async function requestJoin(
  beaconUrls: string[],
  params: JoinParams,
  fetchImpl: typeof fetch = (...args) => fetch(...args),
  timeoutMs = 8_000,
): Promise<JoinResponse> {
  let failure = 'Could not reach the server.';
  for (const base of beaconUrls) {
    let res: Response;
    try {
      res = await fetchImpl(new URL('/v1/rooms/join', base), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...params, protocol: PROTOCOL_VERSION }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      continue;
    }
    if (res.status === 426) throw new UpgradeRequiredError();
    if (res.status === 503) {
      failure = 'No server is available right now.';
      continue;
    }
    if (res.status >= 500) continue;
    if (!res.ok) throw new JoinError('Could not join the room.');
    return JoinResponse.parse(await res.json());
  }
  throw new JoinError(failure);
}
