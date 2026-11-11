import crypto from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { SESSION_COOKIE_NAME, SESSION_TTL_SECONDS } from "./auth.js";

export const CSRF_COOKIE_NAME = "twcin_csrf";
export const CSRF_HEADER_NAME = "x-csrf-token";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const NONCE_HEX_LEN = 48;
const SIG_HEX_LEN = 64;

function signNonce(nonce: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(nonce).digest("hex");
}

function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  return bufA.length === bufB.length && bufA.length > 0 && crypto.timingSafeEqual(bufA, bufB);
}

export function createCsrfToken(secret: string): string {
  const nonce = crypto.randomBytes(NONCE_HEX_LEN / 2).toString("hex");
  return `${nonce}.${signNonce(nonce, secret)}`;
}

export function verifyCsrfTokenSignature(token: string, secret: string): boolean {
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [nonce, sig] = parts;
  if (nonce.length !== NONCE_HEX_LEN || sig.length !== SIG_HEX_LEN) return false;
  if (!/^[0-9a-f]+$/i.test(nonce) || !/^[0-9a-f]+$/i.test(sig)) return false;
  return timingSafeStringEqual(sig, signNonce(nonce, secret));
}

export function verifyDoubleSubmitCsrf(
  cookieToken: string | undefined,
  headerToken: string | string[] | undefined,
  secret: string
): boolean {
  if (typeof cookieToken !== "string" || typeof headerToken !== "string") return false;
  if (!timingSafeStringEqual(cookieToken, headerToken)) return false;
  return verifyCsrfTokenSignature(cookieToken, secret);
}

function applyCsrfCookie(reply: FastifyReply, token: string, cookieSecure: boolean): string {
  reply.setCookie(CSRF_COOKIE_NAME, token, {
    httpOnly: false,
    sameSite: "lax",
    secure: cookieSecure,
    path: "/",
    maxAge: SESSION_TTL_SECONDS
  });
  return token;
}

export function setCsrfCookie(reply: FastifyReply, secret: string, cookieSecure: boolean): string {
  return applyCsrfCookie(reply, createCsrfToken(secret), cookieSecure);
}

export function ensureCsrfCookie(
  request: FastifyRequest,
  reply: FastifyReply,
  secret: string,
  cookieSecure: boolean
): string {
  const existing = request.cookies[CSRF_COOKIE_NAME];
  if (typeof existing === "string" && verifyCsrfTokenSignature(existing, secret)) {
    return existing;
  }
  return setCsrfCookie(reply, secret, cookieSecure);
}

export function clearCsrfCookie(reply: FastifyReply, cookieSecure: boolean): void {
  reply.clearCookie(CSRF_COOKIE_NAME, {
    httpOnly: false,
    sameSite: "lax",
    secure: cookieSecure,
    path: "/"
  });
}

/**
 * Defesa em profundidade contra CSRF via Double-Submit Cookie assinado por HMAC:
 * toda requisição mutável autenticada em `/api/*` precisa repetir no header `X-CSRF-Token`
 * o mesmo token assinado presente no cookie `twcin_csrf`.
 */
export function registerCsrfProtection(app: FastifyInstance, secret: string): void {
  app.addHook("onRequest", async (request, reply) => {
    if (!MUTATING_METHODS.has(request.method)) return;
    const reqPath = request.url.split("?")[0];
    if (!reqPath.startsWith("/api/")) return;

    const sessionCookie = request.cookies[SESSION_COOKIE_NAME];
    if (!sessionCookie) return;

    const cookieToken = request.cookies[CSRF_COOKIE_NAME];
    const headerToken = request.headers[CSRF_HEADER_NAME];
    if (!verifyDoubleSubmitCsrf(cookieToken, headerToken, secret)) {
      return reply.code(403).send({
        error: "Token CSRF ausente ou inválido. Recarregue a página e tente novamente.",
        code: "CSRF_INVALID"
      });
    }
  });
}
