-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "maxPricePaise" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "minPricePaise" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "Product_minPricePaise_idx" ON "Product"("minPricePaise");
