import { PrismaClient } from "@prisma/client";

// Prevents hot-reload in dev from spawning a new PrismaClient
// on every file save (a classic Next.js + Prisma footgun).
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
