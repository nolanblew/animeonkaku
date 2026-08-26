import fastifyStatic from "@fastify/static";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { resolve } from "node:path";

const RESERVED_PREFIXES = ["/api", "/v1", "/admin", "/healthz"];

export function registerWebStaticHosting(app: FastifyInstance, distPath: string): void {
  app.register(fastifyStatic, {
    root: resolve(distPath),
    maxAge: "1y",
    immutable: true,
    serveDotFiles: false,
  });

  app.get("/", async (_request, reply) => sendIndex(reply));
}

export function isSpaNavigationRequest(request: FastifyRequest): boolean {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  const accept = request.headers.accept ?? "";
  if (!accept.split(",").some((value) => value.trim().startsWith("text/html"))) return false;

  let pathname: string;
  try {
    pathname = new URL(request.url, "http://localhost").pathname;
  } catch {
    return false;
  }
  if (RESERVED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) return false;
  const lastSegment = pathname.split("/").at(-1) ?? "";
  return !lastSegment.includes(".");
}

export function sendIndex(reply: FastifyReply): FastifyReply {
  return reply
    .header("Cache-Control", "no-cache, no-store, must-revalidate")
    .sendFile("index.html", { cacheControl: false, immutable: false, maxAge: 0 });
}
