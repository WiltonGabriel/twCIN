import type { FastifyInstance } from "fastify";

export interface ListenOptions {
  port: number;
  host: string;
  autoFallback?: boolean;
  maxAttempts?: number;
  envFilePath?: string;
}

export interface ListenResult {
  port: number;
  fallbackFrom: number | null;
}

function isAddrInUse(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && (err as { code?: unknown }).code === "EADDRINUSE");
}

/**
 * Escuta na porta configurada (fail-fast em serviços) ou busca a próxima livre quando
 * `autoFallback=true` (uso portátil de inicialização rápida).
 */
export async function listenWithPortPolicy(
  app: FastifyInstance,
  options: ListenOptions
): Promise<ListenResult> {
  const basePort = options.port;
  const maxAttempts = options.autoFallback ? Math.max(1, options.maxAttempts ?? 20) : 1;

  for (let offset = 0; offset < maxAttempts; offset++) {
    const candidate = basePort + offset;
    if (candidate > 65535) break;
    try {
      await app.listen({ port: candidate, host: options.host });
      return {
        port: candidate,
        fallbackFrom: offset > 0 ? basePort : null
      };
    } catch (err) {
      if (!isAddrInUse(err)) {
        throw err;
      }
      if (!options.autoFallback) {
        const where = options.envFilePath ? ` em "${options.envFilePath}"` : "";
        const error = new Error(
          `A porta ${basePort} (${options.host}) já está sendo usada por outro programa. Altere PORT${where} ou encerre o processo que ocupa a porta.`
        ) as Error & { code?: string };
        error.code = "EADDRINUSE";
        throw error;
      }
    }
  }

  const error = new Error(
    `Nenhuma porta livre encontrada entre ${basePort} e ${Math.min(65535, basePort + maxAttempts - 1)}.`
  ) as Error & { code?: string };
  error.code = "EADDRINUSE";
  throw error;
}
