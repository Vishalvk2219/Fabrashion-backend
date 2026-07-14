import type { Address, Prisma } from '@prisma/client';

import { prisma } from '@/config/db';

/** Prisma access for addresses. Default-flag bookkeeping is done in the service (in transactions). */
export const addressRepository = {
  listByUser(userId: string): Promise<Address[]> {
    return prisma.address.findMany({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
  },

  findById(id: string): Promise<Address | null> {
    return prisma.address.findUnique({ where: { id } });
  },

  countByUser(userId: string): Promise<number> {
    return prisma.address.count({ where: { userId } });
  },

  firstOther(userId: string, exceptId: string): Promise<Address | null> {
    return prisma.address.findFirst({
      where: { userId, id: { not: exceptId } },
      orderBy: { createdAt: 'desc' },
    });
  },

  /** Clear the default flag on all of a user's addresses (except one, optionally). */
  clearDefault(tx: Prisma.TransactionClient, userId: string, exceptId?: string): Promise<unknown> {
    return tx.address.updateMany({
      where: { userId, isDefault: true, ...(exceptId ? { id: { not: exceptId } } : {}) },
      data: { isDefault: false },
    });
  },
};
