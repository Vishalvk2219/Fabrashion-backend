/**
 * Online availability = sellable-now stock summed across ONLINE locations only:
 * every warehouse + stores with `syncEnabled = true`. Shared by catalog (public availability)
 * and cart/checkout (stock validation + reservation). Never exposes raw per-location stock.
 */
export type InventoryRow = {
  quantityAvailable: number;
  warehouseId: string | null;
  store: { syncEnabled: boolean } | null;
};

const isOnline = (row: InventoryRow): boolean =>
  row.warehouseId !== null || (row.store?.syncEnabled ?? false);

export const onlineAvailableQty = (inventory: InventoryRow[]): number =>
  inventory.reduce((sum, row) => (isOnline(row) ? sum + row.quantityAvailable : sum), 0);
