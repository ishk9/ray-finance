import { config } from "../config.js";
import type { SetuTokenResponse } from "./types.js";

// FIU/AA endpoints use a different base than the standard Setu API
const SETU_BASE_SANDBOX = "https://fiu-sandbox.setu.co";
const SETU_BASE_PROD = "https://fiu.setu.co";
const SETU_AUTH_SANDBOX = "https://uat.setu.co/api/v2/auth/token";
const SETU_AUTH_PROD = "https://prod.setu.co/api/v2/auth/token";

function baseUrl(): string {
  return config.setuEnv === "production" ? SETU_BASE_PROD : SETU_BASE_SANDBOX;
}

function authUrl(): string {
  return config.setuEnv === "production" ? SETU_AUTH_PROD : SETU_AUTH_SANDBOX;
}

// Token cache — reused until 60 seconds before expiry
let cachedToken: string | null = null;
let tokenExpiresAt = 0;

async function getToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && now < tokenExpiresAt - 60_000) {
    return cachedToken;
  }

  const resp = await fetch(authUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientID: config.setuClientId,
      secret: config.setuClientSecret,
      grant_type: "client_credentials",
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Setu auth failed (${resp.status}): ${body}`);
  }

  const raw = await resp.json() as Record<string, any>;

  // Setu wraps the payload under a `data` key: { status, success, data: { token, expiresIn } }
  // Some products return the token at the top level instead
  const payload = (raw.data ?? raw) as SetuTokenResponse;

  const token = payload.access_token ?? payload.token;
  if (!token) {
    throw new Error(`Setu auth succeeded but no token in response: ${JSON.stringify(raw)}`);
  }
  cachedToken = token;
  const expiresIn = payload.expires_in ?? payload.expiresIn ?? 600;
  tokenExpiresAt = now + expiresIn * 1000;
  return cachedToken;
}

function defaultHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "x-product-instance-id": config.setuProductInstanceId,
    "Content-Type": "application/json",
  };
}

export async function setuGet<T>(path: string): Promise<T> {
  const token = await getToken();
  const url = `${baseUrl()}${path}`;
  const resp = await fetch(url, {
    method: "GET",
    headers: defaultHeaders(token),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Setu GET ${path} failed (${resp.status}): ${body}`);
  }

  return resp.json() as Promise<T>;
}

export async function setuPost<T>(path: string, body: unknown): Promise<T> {
  const token = await getToken();
  const url = `${baseUrl()}${path}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: defaultHeaders(token),
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Setu POST ${path} failed (${resp.status}): ${text}`);
  }

  return resp.json() as Promise<T>;
}

/** Invalidate cached token (call on auth errors to force refresh) */
export function invalidateToken(): void {
  cachedToken = null;
  tokenExpiresAt = 0;
}
