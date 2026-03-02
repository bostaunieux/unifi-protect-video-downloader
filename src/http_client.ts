import { fetch, request, Agent, Dispatcher } from "undici";
import { Readable } from "stream";

const IDEMPOTENT_METHODS = new Set(["GET", "HEAD", "OPTIONS", "PUT", "DELETE"]);

/**
 * Error thrown when an HTTP response has status >= 400.
 * Holds status and response body for logging.
 */
export class HttpError extends Error {
  status: number;
  data: string;

  constructor(status: number, data: string) {
    super(`HTTP ${status}`);
    this.name = "HttpError";
    this.status = status;
    this.data = data;
  }
}

function isRetryable(method: string, status: number): boolean {
  return IDEMPOTENT_METHODS.has(method) && status >= 500;
}

function exponentialDelay(retryCount: number): number {
  return Math.pow(2, retryCount) * 100;
}

async function withRetry<T>(fn: () => Promise<T>, options: { retries: number; method: string }): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= options.retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === options.retries) break;
      const status = err instanceof HttpError ? err.status : 0;
      if (status > 0 && !isRetryable(options.method, status)) break;
      await new Promise((r) => setTimeout(r, exponentialDelay(attempt)));
    }
  }
  throw lastError;
}

export interface HttpClientOptions {
  baseUrl: string;
  dispatcher?: Dispatcher;
}

/**
 * HTTP client using undici. Supports fetch for small responses and request for streaming.
 * Throws HttpError on non-2xx responses. Includes retry with exponential backoff.
 */
export class HttpClient {
  private baseUrl: string;
  private dispatcher: Dispatcher;

  constructor({ baseUrl, dispatcher }: HttpClientOptions) {
    this.baseUrl = baseUrl;
    this.dispatcher = dispatcher ?? new Agent({ connect: { rejectUnauthorized: false } });
  }

  private url(path: string, params?: Record<string, string | number>): string {
    const urlBuilder = new URL(path, this.baseUrl);
    if (params) {
      urlBuilder.search = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();
    }
    return urlBuilder.toString();
  }

  async get(path: string, headers?: Record<string, string>) {
    return withRetry(
      async () => {
        const res = await fetch(this.url(path), {
          method: "GET",
          headers,
          dispatcher: this.dispatcher,
        });
        if (!res.ok) {
          const body = await res.text();
          throw new HttpError(res.status, body);
        }
        return res;
      },
      { retries: 5, method: "GET" },
    );
  }

  /** GET that returns response (including non-ok) or null on network error. No retry. */
  async getOptional(path: string, headers?: Record<string, string>) {
    try {
      return await fetch(this.url(path), {
        method: "GET",
        headers,
        dispatcher: this.dispatcher,
      });
    } catch {
      return null;
    }
  }

  async post(path: string, body: unknown, headers?: Record<string, string>) {
    return withRetry(
      async () => {
        const res = await fetch(this.url(path), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...headers,
          },
          body: JSON.stringify(body),
          dispatcher: this.dispatcher,
        });
        if (!res.ok) {
          const text = await res.text();
          throw new HttpError(res.status, text);
        }
        return res;
      },
      { retries: 5, method: "POST" },
    );
  }

  async getStream(
    path: string,
    params: Record<string, string | number>,
    headers?: Record<string, string>,
  ): Promise<Readable> {
    const url = this.url(path, params);
    const res = await request(url, {
      method: "GET",
      headers,
      dispatcher: this.dispatcher,
    });
    if (res.statusCode !== undefined && res.statusCode >= 400) {
      const body = await res.body.text();
      throw new HttpError(res.statusCode, body);
    }
    return res.body;
  }
}
