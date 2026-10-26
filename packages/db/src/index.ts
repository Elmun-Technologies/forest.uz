import { PrismaClient } from '@prisma/client';

export * from '@prisma/client';

/** Creates a Prisma client. Apps own the lifecycle (Nest: PrismaService; scripts: disconnect in finally). */
export function createPrismaClient(url?: string): PrismaClient {
  return new PrismaClient(url ? { datasources: { db: { url } } } : undefined);
}
