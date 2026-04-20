// OnchainOS HTTP client with HMAC-SHA256 request signing.
//
// Authoritative reference: docs/TECHNICAL_DESIGN.md §4.3
//
// All OnchainOS REST calls (Wallet / Gateway / Paymaster / Security) share the
// same authentication scheme: the request is signed with an HMAC-SHA256 MAC of
// a canonical prefix string ("<timestamp><METHOD><path+query><body>"), encoded
// base64, and sent along with the API key, passphrase and project id in the
// request headers. Every concrete API module in this package is a thin wrapper
// around the exported `request` function below.
//
// Env vars (loaded once, at module init time):
//   OKX_API_KEY        — public API key id
//   OKX_SECRET_KEY     — HMAC secret (never logged)
//   OKX_PASSPHRASE     — Dev Portal passphrase
//   OKX_PROJECT_ID     — Dev Portal project id
//   OKX_BASE_URL       — optional, defaults to https://www.okx.com
//
// NOTE: we keep this module framework-free (only axios + node:crypto) so it
// can be unit-tested without spinning up the full MCP server.

import crypto from "node:crypto";
import axios, { AxiosError, type AxiosInstance, type AxiosRequestConfig } from "axios";

/**
 * Thrown for any non-2xx response, signing failure, or network error from the
 * OnchainOS APIs. The `code` field mirrors the `code` string from the response
 * envelope when present, so callers can match specific error codes.
 */
export class OnchainOSError extends Error {
  public readonly status: number;
  public readonly code: string | undefined;
  public readonly data: unknown;

  constructor(message: string, opts: { status?: number; code?: string; data?: unknown } = {}) {
    super(message);
    this.name = "OnchainOSError";
    this.status = opts.status ?? 0;
    this.code = opts.code;
    this.data = opts.data;
  }
}

/** Shape of the standard OnchainOS response envelope. */
export interface OnchainOSEnvelope<T> {
  code: string;
  msg: string;
  data: T;
}

export interface OnchainOSConfig {
  apiKey: string;
  secretKey: string;
  passphrase: string;
  projectId: string;
  baseUrl: string;
}

let cachedConfig: OnchainOSConfig | null = null;
let cachedAxios: AxiosInstance | null = null;

/**
 * Read env vars and cache them. Throws if any required key is missing so that
 * the skill fails fast during `xiake_init` instead of silently mis-signing.
 */
export function getConfig(): OnchainOSConfig {
  if (cachedConfig) return cachedConfig;

  const apiKey = process.env.OKX_API_KEY;
  const secretKey = process.env.OKX_SECRET_KEY;
  const passphrase = process.env.OKX_PASSPHRASE;
  const projectId = process.env.OKX_PROJECT_ID;
  const baseUrl = process.env.OKX_BASE_URL ?? "https://www.okx.com";

  const missing: string[] = [];
  if (!apiKey) missing.push("OKX_API_KEY");
  if (!secretKey) missing.push("OKX_SECRET_KEY");
  if (!passphrase) missing.push("OKX_PASSPHRASE");
  if (!projectId) missing.push("OKX_PROJECT_ID");
  if (missing.length > 0) {
    throw new OnchainOSError(
      `OnchainOS credentials missing: ${missing.join(", ")}. Set these env vars before calling the skill.`,
      { code: "E_CONFIG" },
    );
  }

  cachedConfig = {
    apiKey: apiKey!,
    secretKey: secretKey!,
    passphrase: passphrase!,
    projectId: projectId!,
    baseUrl,
  };
  return cachedConfig;
}

/** Exposed for tests. Clears the singleton config + axios instance. */
export function _resetForTests(): void {
  cachedConfig = null;
  cachedAxios = null;
}

function getHttp(): AxiosInstance {
  if (cachedAxios) return cachedAxios;
  const cfg = getConfig();
  cachedAxios = axios.create({
    baseURL: cfg.baseUrl,
    timeout: 30_000,
    headers: { "Content-Type": "application/json" },
  });
  return cachedAxios;
}

/**
 * Produce the base64 HMAC-SHA256 signature used in `OK-ACCESS-SIGN`.
 *
 * Canonical form: `<ISO-8601 timestamp><UPPERCASE METHOD><requestPath+query><body>`
 * where `body` is the compact JSON body (or "" for GETs). Matches the standard
 * OKX API auth spec also used by OnchainOS.
 */
export function sign(params: {
  timestamp: string;
  method: string;
  path: string;
  body: string;
  secretKey: string;
}): string {
  const { timestamp, method, path, body, secretKey } = params;
  const prehash = `${timestamp}${method.toUpperCase()}${path}${body}`;
  return crypto.createHmac("sha256", secretKey).update(prehash).digest("base64");
}

/** Produce an ISO-8601 ms-precision timestamp, e.g. "2026-04-16T12:34:56.789Z". */
export function isoTimestamp(): string {
  return new Date().toISOString();
}

interface RequestOptions {
  /** Appended to path as a query string. Order is preserved. */
  query?: Record<string, string | number | boolean | undefined>;
  /** JSON body for POST/PUT. */
  body?: unknown;
  /** Extra headers (merged after auth headers). */
  headers?: Record<string, string>;
}

/**
 * Build the path + (sorted) query string that is part of the signing payload.
 * We sort keys to guarantee determinism across node versions / object literal
 * orderings, since any mismatch between client and server canonicalization
 * would be an auth failure.
 */
function buildPathWithQuery(path: string, query: RequestOptions["query"]): string {
  if (!query) return path;
  const entries = Object.entries(query).filter(([, v]) => v !== undefined) as Array<[string, string | number | boolean]>;
  if (entries.length === 0) return path;
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const qs = entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&");
  return `${path}?${qs}`;
}

/**
 * Perform an authenticated HTTP call to OnchainOS and unwrap the envelope.
 *
 * On any non-"0" `code` in the envelope, or any network / 4xx / 5xx error,
 * throws `OnchainOSError` with enough context to debug.
 */
export async function request<T = unknown>(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  opts: RequestOptions = {},
): Promise<T> {
  const cfg = getConfig();
  const http = getHttp();

  const pathWithQuery = buildPathWithQuery(path, opts.query);
  const bodyStr = opts.body === undefined ? "" : JSON.stringify(opts.body);
  const timestamp = isoTimestamp();
  const signature = sign({
    timestamp,
    method,
    path: pathWithQuery,
    body: bodyStr,
    secretKey: cfg.secretKey,
  });

  const axiosReq: AxiosRequestConfig = {
    method,
    url: pathWithQuery,
    headers: {
      "OK-ACCESS-KEY": cfg.apiKey,
      "OK-ACCESS-SIGN": signature,
      "OK-ACCESS-TIMESTAMP": timestamp,
      "OK-ACCESS-PASSPHRASE": cfg.passphrase,
      "OK-ACCESS-PROJECT": cfg.projectId,
      ...opts.headers,
    },
    // Pass the already-serialized string so axios doesn't re-serialize with a
    // different key order (which would invalidate our signature).
    data: bodyStr === "" ? undefined : bodyStr,
  };

  try {
    const resp = await http.request<OnchainOSEnvelope<T>>(axiosReq);
    const envelope = resp.data;
    if (!envelope || typeof envelope !== "object") {
      throw new OnchainOSError("Unexpected non-JSON response from OnchainOS", {
        status: resp.status,
        data: envelope,
      });
    }
    if (envelope.code !== "0") {
      throw new OnchainOSError(`OnchainOS API error [${envelope.code}] ${envelope.msg}`, {
        status: resp.status,
        code: envelope.code,
        data: envelope.data,
      });
    }
    return envelope.data;
  } catch (err) {
    if (err instanceof OnchainOSError) throw err;
    if (err instanceof AxiosError) {
      const envelope = err.response?.data as OnchainOSEnvelope<unknown> | undefined;
      const msg = envelope?.msg ?? err.message;
      throw new OnchainOSError(`OnchainOS HTTP ${err.response?.status ?? "???"} ${method} ${path}: ${msg}`, {
        status: err.response?.status ?? 0,
        code: envelope?.code,
        data: envelope?.data ?? err.response?.data,
      });
    }
    throw new OnchainOSError(`OnchainOS request failed: ${(err as Error).message}`, { code: "E_NETWORK" });
  }
}
