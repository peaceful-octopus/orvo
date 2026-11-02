/** A port the router forwards to us: what the other peer should send to. */
export interface PortMapping {
  externalIp: string;
  externalPort: number;
}

/**
 * Asks the home router to forward a UDP port to a local one (UPnP, PCP or NAT-PMP). Only the desktop and Android
 * apps can; in a browser there is none. With one, a peer behind a strict NAT, such as a phone on mobile data, can
 * reach us directly where it would otherwise need the relay.
 */
export interface PortMapper {
  /** Rejects when there is no router that maps ports, or it refused. */
  map(localIp: string, localPort: number): Promise<PortMapping>;
  unmap(localIp: string, localPort: number): Promise<void>;
}

export interface ParsedCandidate {
  foundation: string;
  component: number;
  protocol: string;
  address: string;
  port: number;
  type: string;
}

/** The fields of an ICE candidate line (`candidate:<foundation> <component> <protocol> <priority> <address> <port> typ <type> …`). */
export function parseCandidate(line: string): ParsedCandidate | undefined {
  const parts = line.replace(/^a=/, '').replace(/^candidate:/, '').trim().split(/\s+/);
  if (parts.length < 8 || parts[6] !== 'typ') return undefined;
  const [foundation, component, protocol, , address, port, , type] = parts as [string, string, string, string, string, string, string, string];
  const parsed = { foundation, component: Number(component), protocol: protocol.toLowerCase(), address, port: Number(port), type };
  return Number.isInteger(parsed.component) && Number.isInteger(parsed.port) ? parsed : undefined;
}

/** A private IPv4 address (10/8, 172.16/12, 192.168/16): what a device behind a home router has. */
export function isPrivateIpv4(address: string): boolean {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) return false;
  const [a, b] = octets as [number, number, number, number];
  return a === 10 || (a === 172 && b >= 16 && b < 32) || (a === 192 && b === 168);
}

/**
 * Whether a router could forward to this local candidate. Only our own UDP addresses on a private network qualify;
 * the browser hides them behind `.local` names when it has no camera or microphone permission, and those cannot be.
 */
export function canMap(candidate: ParsedCandidate): boolean {
  return candidate.type === 'host' && candidate.protocol === 'udp' && candidate.component === 1 && isPrivateIpv4(candidate.address);
}

/**
 * ICE ranks a candidate by type, then by a local preference. A mapped port is reached from outside like a
 * server-reflexive one, so it is ranked as one (RFC 8445 §5.1.2.1: type preference 100), at the top of that type.
 */
const MAPPED_PRIORITY = 100 * 2 ** 24 + 65_535 * 2 ** 8 + 255;

/**
 * The candidate to send the other peer for a mapped port: the router's public address, standing for our local one.
 * It goes to the same media section as the local candidate it was made from.
 */
export function mappedCandidate(local: RTCIceCandidateInit, host: ParsedCandidate, mapping: PortMapping): RTCIceCandidateInit {
  const line =
    `candidate:pm${host.foundation.slice(0, 30)} 1 udp ${MAPPED_PRIORITY} ${mapping.externalIp} ${mapping.externalPort} ` +
    `typ srflx raddr ${host.address} rport ${host.port}`;
  return { candidate: line, sdpMid: local.sdpMid, sdpMLineIndex: local.sdpMLineIndex, usernameFragment: local.usernameFragment };
}
