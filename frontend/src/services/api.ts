export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function isNetworkError(err: unknown): boolean {
  if (err instanceof ApiError) return false;
  return err instanceof TypeError || (typeof navigator !== "undefined" && !navigator.onLine);
}

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function readCsrfCookie(): string | null {
  if (typeof document === "undefined") return null;
  const parts = document.cookie ? document.cookie.split(";") : [];
  for (const raw of parts) {
    const idx = raw.indexOf("=");
    if (idx < 0) continue;
    const key = raw.slice(0, idx).trim();
    if (key === "twcin_csrf") {
      return decodeURIComponent(raw.slice(idx + 1).trim());
    }
  }
  return null;
}

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const method = (init?.method ?? "GET").toUpperCase();
  const isMutating = MUTATING_METHODS.has(method);
  if (isMutating && !headers.has("X-CSRF-Token")) {
    const csrfToken = readCsrfCookie();
    if (csrfToken) {
      headers.set("X-CSRF-Token", csrfToken);
    }
  }

  let response = await fetch(path, {
    ...init,
    headers,
    credentials: "include"
  });

  // Se uma sessão antiga existir sem cookie twcin_csrf, obtém o token uma vez e repete.
  if (isMutating && typeof document !== "undefined" && response.status === 403 && path !== "/api/auth/csrf") {
    const body = (await response.clone().json().catch(() => null)) as { code?: string } | null;
    if (body?.code === "CSRF_INVALID") {
      try {
        const csrfRes = await fetch("/api/auth/csrf", { credentials: "include" });
        if (csrfRes.ok) {
          const payload = (await csrfRes.json()) as { csrf_token?: string };
          const refreshed = payload.csrf_token || readCsrfCookie();
          if (refreshed) {
            headers.set("X-CSRF-Token", refreshed);
            response = await fetch(path, {
              ...init,
              headers,
              credentials: "include"
            });
          }
        }
      } catch {
        // Sem conexão: retorna a resposta original para o caller tratar.
      }
    }
  }

  return response;
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(path, init);

  const isJson = response.headers.get("content-type")?.includes("application/json");
  const data = isJson ? await response.json() : null;

  if (!response.ok) {
    throw new ApiError(
      data?.error || `Erro HTTP ${response.status}`,
      response.status,
      data?.details
    );
  }

  return data as T;
}

export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error("Não foi possível ler o arquivo selecionado."));
    reader.readAsDataURL(file);
  });
}
