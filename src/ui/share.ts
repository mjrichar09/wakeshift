// Share: every parameter that differs from the sport's defaults goes into the URL hash
// (base64url JSON), so a configuration can be bookmarked or sent.

import type { Params, ParamsPatch, Sport } from "../physics/params";
import { defaultParams, withPatch } from "../physics/params";

function diff(a: unknown, b: unknown): unknown {
  if (Array.isArray(a) || Array.isArray(b)) return JSON.stringify(a) === JSON.stringify(b) ? undefined : a;
  if (a && typeof a === "object" && b && typeof b === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(a as object)) {
      const d = diff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]);
      if (d !== undefined) out[k] = d;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return a === b ? undefined : a;
}

export function paramsDiff(p: Params): ParamsPatch {
  return (diff(p, defaultParams(p.sport)) as ParamsPatch) ?? {};
}

const b64 = (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64 = (s: string) => decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/"))));

export interface ShareState {
  params: Params;
  view?: string;
  preset?: string;
}

export function encodeHash(s: ShareState): string {
  const body = { s: s.params.sport, d: paramsDiff(s.params), v: s.view, p: s.preset };
  return `#c=${b64(JSON.stringify(body))}`;
}

export function decodeHash(hash: string): ShareState | null {
  const m = /[#&]c=([A-Za-z0-9_-]+)/.exec(hash);
  if (!m) return null;
  try {
    const body = JSON.parse(unb64(m[1])) as { s: Sport; d: ParamsPatch; v?: string; p?: string };
    if (body.s !== "baseball" && body.s !== "volleyball") return null;
    return { params: withPatch(defaultParams(body.s), body.d ?? {}), view: body.v, preset: body.p };
  } catch {
    return null;
  }
}
