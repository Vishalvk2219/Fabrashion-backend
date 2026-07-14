import { prisma } from '@/config/db';
import { ForbiddenError, NotFoundError } from '@/lib/errors';
import { type AddressDTO, toAddress } from './address.mapper';
import { addressRepository } from './address.repository';
import type { CreateAddressInput, UpdateAddressInput } from './address.schema';

/** Fetch an address and assert it belongs to the user (404 unknown, 403 someone else's). */
async function ownedAddress(userId: string, id: string) {
  const address = await addressRepository.findById(id);
  if (!address) throw new NotFoundError('Address not found');
  if (address.userId !== userId) throw new ForbiddenError();
  return address;
}

export const addressService = {
  async list(userId: string): Promise<AddressDTO[]> {
    return (await addressRepository.listByUser(userId)).map(toAddress);
  },

  async create(userId: string, input: CreateAddressInput): Promise<AddressDTO> {
    // First address is always default; an explicit isDefault clears the others.
    const count = await addressRepository.countByUser(userId);
    const isDefault = input.isDefault || count === 0;

    const created = await prisma.$transaction(async (tx) => {
      const address = await tx.address.create({ data: { ...input, userId, isDefault } });
      if (isDefault) await addressRepository.clearDefault(tx, userId, address.id);
      return address;
    });
    return toAddress(created);
  },

  async update(userId: string, id: string, input: UpdateAddressInput): Promise<AddressDTO> {
    await ownedAddress(userId, id);
    const updated = await prisma.$transaction(async (tx) => {
      const address = await tx.address.update({ where: { id }, data: input });
      if (input.isDefault) await addressRepository.clearDefault(tx, userId, id);
      return address;
    });
    return toAddress(updated);
  },

  async remove(userId: string, id: string): Promise<{ addresses: AddressDTO[] }> {
    const address = await ownedAddress(userId, id);
    await prisma.$transaction(async (tx) => {
      await tx.address.delete({ where: { id } });
      // Deleting the default promotes the next most-recent address.
      if (address.isDefault) {
        const next = await addressRepository.firstOther(userId, id);
        if (next) await tx.address.update({ where: { id: next.id }, data: { isDefault: true } });
      }
    });
    return { addresses: await this.list(userId) };
  },
};
