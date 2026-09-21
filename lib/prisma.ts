import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function buildUrl(url: string | undefined): string | undefined {
  if (!url) return url;
  return url + (url.includes("?") ? "&" : "?") + "connection_limit=2";
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    datasources: { db: { url: buildUrl(process.env.DATABASE_URL) } },
  });

globalForPrisma.prisma = prisma;
