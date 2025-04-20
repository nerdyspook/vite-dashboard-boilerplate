import axios, {
  AxiosError,
  AxiosInstance,
  AxiosRequestConfig,
  AxiosResponse,
  InternalAxiosRequestConfig,
  Method,
} from "axios";

/**
 * Module augmentation: tell TS that every InternalAxiosRequestConfig
 * can optionally have our custom `metadata` object.
 */
declare module "axios" {
  interface InternalAxiosRequestConfig {
    metadata?: { startTime: number };
  }
}

/**
 * A function that, when called, returns your current auth token
 * (JWT, session ID, etc.), or null if not logged in.
 */
export type TokenProvider = () => Promise<string | null>;

/**
 * Built‑in token providers. Swap in your own if you need
 * SecureStore, Keychain, cookie-based refresh, etc.
 */
export const localStorageProvider =
  (key: string): TokenProvider =>
  async () =>
    localStorage.getItem(key);

export const sessionStorageProvider =
  (key: string): TokenProvider =>
  async () =>
    sessionStorage.getItem(key);

/**
 * Read a non‑httpOnly cookie by name.
 * Returns the decoded value or null if not found.
 */
function getCookieValue(name: string): string | null {
  // `document.cookie` is a string like "foo=1; bar=hello%20world; baz=3"
  // 1) Split into ["foo=1", "bar=hello%20world", "baz=3"]
  const pairs = document.cookie ? document.cookie.split("; ") : [];
  for (const pair of pairs) {
    // 2) Split each "key=value" into ["key", "value"]
    const [key, ...rest] = pair.split("=");
    if (key === name) {
      // 3) Re‑join in case the value had '=' chars, then decode
      return decodeURIComponent(rest.join("="));
    }
  }
  return null;
}

export const cookieProvider =
  (name: string): TokenProvider =>
  async () => {
    return getCookieValue(name);
  };

/**
 * Let the app choose which provider to use at startup.
 * Default: localStorage under "auth_token".
 */
let tokenProvider: TokenProvider = localStorageProvider("auth_token");
export const setTokenProvider = (p: TokenProvider) => {
  tokenProvider = p;
};

/**
 * Our single Axios instance for the dashboard.
 * You can change baseURL, timeout, interceptors here.
 */
const api: AxiosInstance = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL,
  timeout: 15_000,
});

/**
 * Logging interceptors (only in development):
 * - Logs method, URL, payload on request
 * - Logs status, URL, elapsed time on response
 * - Logs error details on failed responses
 */
if (import.meta.env.DEV) {
  // Request interceptor: stamp time & log
  api.interceptors.request.use((request: InternalAxiosRequestConfig) => {
    // add metadata
    request.metadata = { startTime: performance.now() };

    const fullUrl = `${request.baseURL ?? ""}${request.url ?? ""}`;
    console.debug(
      "[HTTP ▶️]",
      request.method?.toUpperCase(),
      fullUrl,
      request.params ?? request.data
    );

    return request; // return the same InternalAxiosRequestConfig
  });

  // Response interceptor: log success or error
  api.interceptors.response.use(
    (response: AxiosResponse) => {
      const config = response.config as InternalAxiosRequestConfig;
      const start = config.metadata?.startTime ?? performance.now();
      const duration = Math.round(performance.now() - start);
      const fullUrl = `${config.baseURL ?? ""}${config.url ?? ""}`;

      console.debug(
        "[HTTP ✅]",
        response.status,
        config.method?.toUpperCase(),
        fullUrl,
        `(${duration}ms)`
      );

      return response; // still return the full response
    },
    (error: AxiosError) => {
      const config = error.config as InternalAxiosRequestConfig;
      const start = config.metadata?.startTime ?? performance.now();
      const duration = Math.round(performance.now() - start);
      const fullUrl = `${config.baseURL ?? ""}${config.url ?? ""}`;

      console.error(
        "[HTTP ❌]",
        error.response?.status,
        config.method?.toUpperCase(),
        fullUrl,
        `(${duration}ms)`,
        error.response?.data ?? error.message
      );

      return Promise.reject(error);
    }
  );
}

/**
 * Recursively strip out:
 *  - null or undefined
 *  - empty objects {}
 *  - empty arrays []
 *
 * Arrays: map + filter
 * Objects: reduce to keep only non‑empty fields
 * Primitives: returned as‑is
 */
function clean<T>(obj: T): T {
  if (Array.isArray(obj)) {
    return (obj as unknown[])
      .map(clean)
      .filter(
        (v): v is NonNullable<typeof v> =>
          v != null && (typeof v !== "object" || Object.keys(v).length > 0)
      ) as T;
  }

  if (obj && typeof obj === "object") {
    return (Object.entries(obj) as [string, unknown][]).reduce(
      (acc, [k, v]) => {
        const cleaned = clean(v);
        if (
          cleaned != null &&
          (typeof cleaned !== "object" || Object.keys(cleaned).length > 0)
        ) {
          // store into a plain object
          (acc as Record<string, unknown>)[k] = cleaned;
        }
        return acc;
      },
      {} as Record<string, unknown>
    ) as T;
  }

  // primitives (string, number, boolean, etc.) returned as-is
  return obj;
}

/**
 * Configuration you pass into getRequest/postRequest/etc.
 */
export interface HttpConfig {
  /** path + query, e.g. "/users" or "/orders?status=paid" */
  url: string;

  /** body for POST/PUT/PATCH */
  data?: unknown;

  /** query params for GET/DELETE */
  params?: unknown;

  /** extra headers on a per‑call basis */
  headers?: Record<string, string>;

  /**
   * extra axios options: timeout override, responseType, etc.
   * (won’t overwrite url, method, data, params, or headers)
   */
  options?: Omit<
    AxiosRequestConfig,
    "url" | "method" | "data" | "params" | "headers"
  >;

  /** false = skip clean(); default = clean */
  doClean?: boolean;
}

/**
 * Core HTTP function:
 * 1) grabs token,
 * 2) builds headers,
 * 3) chooses data vs params,
 * 4) cleans payload if needed,
 * 5) calls axios
 * 6) returns res.data
 */
export async function http<T = unknown>(
  method: Method,
  config: HttpConfig
): Promise<T> {
  // 1) grabs the latest token
  const token = await tokenProvider();

  // 2) build headers
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    ...(config.headers || {}),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  // 3) choose body/data vs query params
  const m = method.toLowerCase();
  const isBody = ["post", "put", "patch"].includes(m);
  const payloadKey = isBody ? "data" : "params";
  const raw = isBody ? config.data : config.params;

  // 4) optionally clean it
  const payload = config.doClean === false || raw == null ? raw : clean(raw);

  // 5) fire the request
  const response = await api.request<T>({
    method,
    url: config.url,
    headers,
    [payloadKey]: payload,
    ...(config.options || {}),
  });

  // 6) return the body only
  return response.data;
}

/** Convenience wrappers */
export const getRequest = <T = unknown>(config: HttpConfig) =>
  http<T>("get", config);
export const postRequest = <T = unknown>(config: HttpConfig) =>
  http<T>("post", config);
export const putRequest = <T = unknown>(config: HttpConfig) =>
  http<T>("put", config);
export const patchRequest = <T = unknown>(config: HttpConfig) =>
  http<T>("patch", config);
export const deleteRequest = <T = unknown>(config: HttpConfig) =>
  http<T>("delete", config);
