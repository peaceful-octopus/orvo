/** Signaling and data-channel wire version. Bump only for incompatible changes. */
export const PROTOCOL_VERSION = 1;

/** Compares dotted numeric versions such as 1.2.10. Returns <0, 0 or >0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function isClientSupported(
  client: { version: string; protocol: number },
  required: { minClientVersion: string; minProtocol: number },
): boolean {
  return compareVersions(client.version, required.minClientVersion) >= 0 && client.protocol >= required.minProtocol;
}
