// NIDO Protocol Conformance Suite v0 — reference-ts
// Version negotiation (no silent downgrade) and extension anti-shadowing.

import { Result, ok, err } from './types';

export type VersionError = 'UNSUPPORTED_VERSION' | 'VERSION_MALFORMED';

function parseNidoVersion(v: string): { major: number; minor: number } | null {
  const m = /^nido\/(\d+)\.(\d+)$/.exec(v);
  if (!m) return null;
  return { major: parseInt(m[1], 10), minor: parseInt(m[2], 10) };
}

function cmp(a: { major: number; minor: number }, b: { major: number; minor: number }): number {
  return a.major - b.major || a.minor - b.minor;
}

// Highest mutually supported version, or UNSUPPORTED_VERSION.
// A MITM that lowers the peer's advertised max cannot force us below the true
// overlap: we pick the highest version both claim to support, and any version
// below our minimum is rejected outright.
export function negotiateVersion(
  localMin: string,
  localMax: string,
  peerMin: string,
  peerMax: string
): Result<string, VersionError> {
  const lmin = parseNidoVersion(localMin);
  const lmax = parseNidoVersion(localMax);
  const pmin = parseNidoVersion(peerMin);
  const pmax = parseNidoVersion(peerMax);
  if (!lmin || !lmax || !pmin || !pmax) return err('VERSION_MALFORMED');
  if (cmp(lmin, lmax) > 0 || cmp(pmin, pmax) > 0) return err('VERSION_MALFORMED');
  const floor = cmp(lmin, pmin) >= 0 ? lmin : pmin;
  const ceil = cmp(lmax, pmax) <= 0 ? lmax : pmax;
  if (cmp(floor, ceil) > 0) return err('UNSUPPORTED_VERSION');
  return ok(`nido/${ceil.major}.${ceil.minor}`);
}

// Capability version negotiation: same rule, capability-scoped versions 'vN'.
export function negotiateCapabilityVersion(
  localVersions: string[],
  peerVersions: string[]
): Result<string, VersionError> {
  const num = (v: string): number | null => {
    const m = /^v(\d+)$/.exec(v);
    return m ? parseInt(m[1], 10) : null;
  };
  const l = localVersions.map(num);
  const p = peerVersions.map(num);
  if (l.some((n) => n === null) || p.some((n) => n === null)) return err('VERSION_MALFORMED');
  const common = (l as number[]).filter((n) => (p as number[]).includes(n));
  if (common.length === 0) return err('UNSUPPORTED_VERSION');
  return ok(`v${Math.max(...common)}`);
}

export type RegistryError = 'EXTENSION_SHADOWING' | 'ALREADY_REGISTERED';

// Extension registry: an extension may NEVER shadow a core capability name.
// Core names are exact strings; shadowing includes exact match only in v0
// (visual-similarity policy is a UX concern, tested via vectors as DENY by
// policy since no rule will pin a lookalike name).
export class CapabilityRegistry {
  private core = new Set<string>();
  private extensions = new Set<string>();

  registerCore(name: string): void {
    this.core.add(name);
  }

  registerExtension(name: string): Result<void, RegistryError> {
    if (this.core.has(name)) return err('EXTENSION_SHADOWING');
    if (this.extensions.has(name)) return err('ALREADY_REGISTERED');
    this.extensions.add(name);
    return ok(undefined);
  }

  isCore(name: string): boolean {
    return this.core.has(name);
  }
}
