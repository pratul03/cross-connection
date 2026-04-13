const PRIVATE_RANGES = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^192\.168\./,
  /^0\./
];

const PRIVATE_IPV6_PREFIXES = [/^fc/i, /^fd/i, /^fe8/i, /^fe9/i, /^fea/i, /^feb/i];

type LookupResult = { address: string; family: number };

function getNodeRequire(): ((id: string) => unknown) | undefined {
  try {
    return (0, eval)("require") as (id: string) => unknown;
  } catch {
    return undefined;
  }
}

function isLikelyIPv4(value: string): boolean {
  return /^\d+\.\d+\.\d+\.\d+$/.test(value);
}

function isLikelyIPv6(value: string): boolean {
  return value.includes(":");
}

function detectIpVersion(value: string): 0 | 4 | 6 {
  const req = getNodeRequire();
  if (req) {
    const nodeNet = req("net") as { isIP: (input: string) => 0 | 4 | 6 };
    return nodeNet.isIP(value);
  }

  if (isLikelyIPv4(value)) {
    return 4;
  }

  if (isLikelyIPv6(value)) {
    return 6;
  }

  return 0;
}

async function lookupAllNodeAddresses(hostname: string): Promise<LookupResult[]> {
  const req = getNodeRequire();
  if (!req) {
    return [];
  }

  const dnsModule = req("dns") as {
    promises?: {
      lookup: (host: string, opts: { all: true }) => Promise<LookupResult[]>;
    };
  };

  if (!dnsModule.promises) {
    return [];
  }

  return dnsModule.promises.lookup(hostname, { all: true });
}

function isPrivateIPv4(ip: string): boolean {
  return PRIVATE_RANGES.some((rx) => rx.test(ip));
}

function stripIPv6Brackets(host: string): string {
  return host.replace(/^\[/, "").replace(/\]$/, "");
}

function isPrivateIPv6(ip: string): boolean {
  const normalized = stripIPv6Brackets(ip).toLowerCase();

  if (normalized === "::1" || normalized === "::") {
    return true;
  }

  if (normalized.startsWith("::ffff:")) {
    const mapped = normalized.slice("::ffff:".length);
    return isPrivateIPv4(mapped);
  }

  const firstHextet = normalized.split(":")[0];
  return PRIVATE_IPV6_PREFIXES.some((rx) => rx.test(firstHextet));
}

function normalizeHostname(hostname: string): string {
  return stripIPv6Brackets(hostname.trim().toLowerCase());
}

function matchesAllowHostPattern(hostname: string, pattern: string): boolean {
  const normalizedPattern = normalizeHostname(pattern);
  if (!normalizedPattern) {
    return false;
  }

  if (normalizedPattern.startsWith("*.")) {
    const base = normalizedPattern.slice(2);
    return hostname === base || hostname.endsWith(`.${base}`);
  }

  return hostname === normalizedPattern;
}

export function isLocalhost(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  return normalized === "localhost" || normalized === "::1" || normalized === "[::1]";
}

export async function resolveAndValidateHost(
  hostname: string,
  options: {
    blockPrivateIPs: boolean;
    blockPrivateIPv6: boolean;
    blockLocalhost: boolean;
    allowHosts: string[];
  }
): Promise<void> {
  const normalized = normalizeHostname(hostname);

  if (options.allowHosts.length > 0) {
    const allowed = options.allowHosts.some((pattern) => matchesAllowHostPattern(normalized, pattern));
    if (!allowed) {
      throw new Error(`Blocked target outside allowlist: ${hostname}`);
    }
  }

  if (options.blockLocalhost && isLocalhost(normalized)) {
    throw new Error(`Blocked localhost target: ${hostname}`);
  }

  const ipVersion = detectIpVersion(normalized);
  if (ipVersion === 4) {
    if (options.blockPrivateIPs && isPrivateIPv4(normalized)) {
      throw new Error(`Blocked private IP target: ${hostname}`);
    }
    return;
  }

  if (ipVersion === 6) {
    if (options.blockPrivateIPv6 && isPrivateIPv6(normalized)) {
      throw new Error(`Blocked private IPv6 target: ${hostname}`);
    }
    return;
  }

  if (typeof process === "undefined" || process.release?.name !== "node") {
    return;
  }

  const dnsResults = await lookupAllNodeAddresses(normalized);
  for (const result of dnsResults) {
    if (result.family === 4 && options.blockPrivateIPs && isPrivateIPv4(result.address)) {
      throw new Error(`Blocked target resolved to private IP: ${result.address}`);
    }

    if (result.family === 6 && options.blockPrivateIPv6 && isPrivateIPv6(result.address)) {
      throw new Error(`Blocked target resolved to private IPv6: ${result.address}`);
    }
  }
}
