export interface ApiClientOptions {
  baseUrl: string;
  getAccessToken?: () => Promise<string | null>;
  refreshAccessToken?: () => Promise<string | null>;
}

export interface ApiRequestOptions {
  signal?: AbortSignal;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class ApiClient {
  private refreshPromise: Promise<string | null> | null = null;
  constructor(private readonly options: ApiClientOptions) {}

  async get<T>(
    path: string,
    query?: Record<string, string | number | undefined>,
    options?: ApiRequestOptions,
  ): Promise<T> {
    return this.request<T>("GET", path, undefined, query, options);
  }

  async post<T>(path: string, body?: unknown, options?: ApiRequestOptions): Promise<T> {
    return this.request<T>("POST", path, body, undefined, options);
  }

  async patch<T>(path: string, body?: unknown, options?: ApiRequestOptions): Promise<T> {
    return this.request<T>("PATCH", path, body, undefined, options);
  }

  async put<T>(path: string, body?: unknown, options?: ApiRequestOptions): Promise<T> {
    return this.request<T>("PUT", path, body, undefined, options);
  }

  async delete<T>(path: string, body?: unknown, options?: ApiRequestOptions): Promise<T> {
    return this.request<T>("DELETE", path, body, undefined, options);
  }

  async putBinary(
    pathOrUrl: string,
    body: Blob,
    headers: Record<string, string>,
    options?: ApiRequestOptions,
  ): Promise<void> {
    const baseUrl = this.options.baseUrl.endsWith("/")
      ? this.options.baseUrl
      : `${this.options.baseUrl}/`;
    const base = new URL(baseUrl);
    const url = /^https?:\/\//i.test(pathOrUrl)
      ? new URL(pathOrUrl)
      : pathOrUrl.startsWith("/")
        ? new URL(pathOrUrl, base.origin)
        : new URL(pathOrUrl, base);
    const token =
      url.origin === base.origin ? await this.options.getAccessToken?.() : null;
    const response = await fetch(url, {
      method: "PUT",
      headers: {
        ...headers,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body,
      signal: options?.signal,
    });
    if (!response.ok)
      throw new Error(
        `媒体上传失败：${response.status} ${response.statusText}`,
      );
  }

  resolveServerPath(path?: string): string | undefined {
    if (!path) return undefined;
    if (/^https?:\/\//i.test(path)) return path;
    const baseUrl = this.options.baseUrl.endsWith("/")
      ? this.options.baseUrl
      : `${this.options.baseUrl}/`;
    const origin = new URL(baseUrl).origin;
    return `${origin}${path.startsWith("/") ? path : `/${path}`}`;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    query?: Record<string, string | number | undefined>,
    requestOptions?: ApiRequestOptions,
    retried = false,
  ): Promise<T> {
    const baseUrl = this.options.baseUrl.endsWith("/")
      ? this.options.baseUrl
      : `${this.options.baseUrl}/`;
    const url = new URL(path.replace(/^\/+/, ""), baseUrl);
    Object.entries(query ?? {}).forEach(([key, value]) => {
      if (value !== undefined) url.searchParams.set(key, String(value));
    });

    const token = await this.options.getAccessToken?.();
    const serializedBody =
      body === undefined ? undefined : JSON.stringify(body);
    const response = await fetch(url, {
      method,
      headers: {
        ...(serializedBody === undefined
          ? {}
          : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: serializedBody,
      signal: requestOptions?.signal,
    });

    if (
      response.status === 401 &&
      !retried &&
      this.options.refreshAccessToken
    ) {
      const refreshed = await this.refreshOnce();
      if (refreshed)
        return this.request<T>(
          method,
          path,
          body,
          query,
          requestOptions,
          true,
        );
    }

    if (!response.ok) {
      let detail = response.statusText;
      try {
        const payload = (await response.json()) as {
          error?: string;
          message?: string;
        };
        detail = payload.message ?? payload.error ?? detail;
      } catch {
        // Keep the status text when the response body is not JSON.
      }
      throw new ApiError(
        detail || `接口请求失败：${response.status}`,
        response.status,
      );
    }

    return (await response.json()) as T;
  }

  private refreshOnce() {
    if (!this.options.refreshAccessToken) return Promise.resolve(null);
    if (!this.refreshPromise) {
      this.refreshPromise = this.options
        .refreshAccessToken()
        .finally(() => (this.refreshPromise = null));
    }
    return this.refreshPromise;
  }
}
