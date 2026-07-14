import { ConflictError, ForbiddenError, NotFoundError } from '@/lib/errors';
import { onlineAvailableQty } from '@/lib/inventory';
import { type CartDTO, toCart } from './cart.mapper';
import { cartRepository } from './cart.repository';
import type { AddItemInput } from './cart.schema';

/** Reject when the requested quantity exceeds live online availability. */
function assertStock(available: number, requested: number): void {
  if (requested > available) {
    throw new ConflictError(
      available > 0 ? `Only ${available} left in stock` : 'Out of stock',
    );
  }
}

export const cartService = {
  async getCart(userId: string): Promise<CartDTO> {
    return toCart(await cartRepository.getOrCreateActiveCart(userId));
  },

  async addItem(userId: string, input: AddItemInput): Promise<CartDTO> {
    const cart = await cartRepository.getOrCreateActiveCart(userId);
    const variant = await cartRepository.findVariantStock(input.variantId);
    if (!variant) throw new NotFoundError('Product variant not found');

    const existing = cart.items.find((i) => i.variantId === input.variantId);
    const desired = (existing?.quantity ?? 0) + input.quantity;
    assertStock(onlineAvailableQty(variant.inventory), desired);

    await cartRepository.upsertItem(cart.id, input.variantId, desired);
    return toCart(await cartRepository.getOrCreateActiveCart(userId));
  },

  async setItemQty(userId: string, itemId: string, quantity: number): Promise<CartDTO> {
    const item = await cartRepository.findItem(itemId);
    if (!item) throw new NotFoundError('Cart item not found');
    if (item.cart.userId !== userId) throw new ForbiddenError();

    if (quantity <= 0) {
      await cartRepository.deleteItem(itemId);
    } else {
      assertStock(onlineAvailableQty(item.variant.inventory), quantity);
      await cartRepository.updateItemQty(itemId, quantity);
    }
    return toCart(await cartRepository.getOrCreateActiveCart(userId));
  },

  async removeItem(userId: string, itemId: string): Promise<CartDTO> {
    const item = await cartRepository.findItem(itemId);
    if (!item) throw new NotFoundError('Cart item not found');
    if (item.cart.userId !== userId) throw new ForbiddenError();
    await cartRepository.deleteItem(itemId);
    return toCart(await cartRepository.getOrCreateActiveCart(userId));
  },
};
