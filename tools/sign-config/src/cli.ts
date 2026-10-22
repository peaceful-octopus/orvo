import {
  ClientConfig,
  fromBase64Url,
  generateKeyPair,
  signConfig,
  toBase64Url,
  verifyConfig,
} from '@chillcall/protocol';

export interface Io {
  readFile(path: string): string;
  writeFile(path: string, content: string): void;
  env: Record<string, string | undefined>;
  now(): number;
  out(line: string): void;
}

export const USAGE = `chillcall-sign-config <command>

  keygen [--kid <id>]
      Print a new signing key. Keep "secretKey" private (SIGNING_KEY=<kid>:<secretKey> for the beacon);
      embed "publicKey" in the app (VITE_TRUSTED_KEYS='{"<kid>":"<publicKey>"}').

  sign <config.json> [--key <kid>:<secretKey>] [--out <file>] [--valid-days <n>]
      Validate a client config and sign it for CDN hosting. Fills in version (epoch seconds),
      issuedAt and validUntil unless the file sets them. The key comes from --key or $SIGNING_KEY.

  verify <signed.json> --public <kid>:<publicKey> [--min-version <n>]
      Check a signed config the way a client would.
`;

class UsageError extends Error {}

function flags(args: string[]): { positional: string[]; flags: Map<string, string> } {
  const positional: string[] = [];
  const map = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg.startsWith('--')) {
      const value = args[i + 1];
      if (value === undefined || value.startsWith('--')) throw new UsageError(`${arg} needs a value`);
      map.set(arg.slice(2), value);
      i++;
    } else positional.push(arg);
  }
  return { positional, flags: map };
}

function splitKey(value: string, what: string): [string, string] {
  const index = value.indexOf(':');
  if (index < 1 || index === value.length - 1) throw new UsageError(`${what} must look like <kid>:<key>`);
  return [value.slice(0, index), value.slice(index + 1)];
}

/** Runs the CLI and returns a process exit code. */
export function run(argv: string[], io: Io): number {
  try {
    const [command, ...rest] = argv;
    const { positional, flags: f } = flags(rest);

    if (command === 'keygen') {
      const pair = generateKeyPair();
      io.out(JSON.stringify({ kid: f.get('kid') ?? 'key-1', publicKey: toBase64Url(pair.publicKey), secretKey: toBase64Url(pair.secretKey) }, null, 2));
      return 0;
    }

    if (command === 'sign') {
      const [file] = positional;
      if (!file) throw new UsageError('sign needs a config file');
      const keyText = f.get('key') ?? io.env.SIGNING_KEY;
      if (!keyText) throw new UsageError('give the signing key with --key or $SIGNING_KEY');
      const [kid, secret] = splitKey(keyText, 'the signing key');

      const parsed = ClientConfig.partial({ version: true, issuedAt: true, validUntil: true }).safeParse(JSON.parse(io.readFile(file)));
      if (!parsed.success) throw new UsageError(`invalid config: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);

      const now = io.now();
      const days = Number(f.get('valid-days') ?? 30);
      const config: ClientConfig = {
        ...parsed.data,
        version: parsed.data.version ?? Math.floor(now / 1000),
        issuedAt: parsed.data.issuedAt ?? now,
        validUntil: parsed.data.validUntil ?? now + days * 24 * 3600_000,
      };
      const signed = JSON.stringify(signConfig(config, kid, fromBase64Url(secret)), null, 2);
      const out = f.get('out');
      if (out) io.writeFile(out, `${signed}\n`);
      else io.out(signed);
      return 0;
    }

    if (command === 'verify') {
      const [file] = positional;
      const publicText = f.get('public');
      if (!file || !publicText) throw new UsageError('verify needs a signed file and --public <kid>:<publicKey>');
      const [kid, pub] = splitKey(publicText, '--public');
      const result = verifyConfig(JSON.parse(io.readFile(file)), {
        keys: { [kid]: fromBase64Url(pub) },
        now: io.now(),
        graceMs: 0,
        cachedVersion: f.has('min-version') ? Number(f.get('min-version')) : undefined,
      });
      if (!result.ok) {
        io.out(`INVALID: ${result.reason}`);
        return 1;
      }
      io.out(`OK: version ${result.config.version}, valid until ${new Date(result.config.validUntil).toISOString()}`);
      return 0;
    }

    io.out(USAGE);
    return command ? 2 : 0;
  } catch (err) {
    io.out(`error: ${err instanceof Error ? err.message : String(err)}`);
    return err instanceof UsageError ? 2 : 1;
  }
}
