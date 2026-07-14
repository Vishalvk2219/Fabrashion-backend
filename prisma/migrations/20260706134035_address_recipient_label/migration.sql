-- CreateEnum
CREATE TYPE "AddressLabel" AS ENUM ('HOME', 'WORK', 'OTHER');

-- AlterTable
ALTER TABLE "Address" ADD COLUMN     "label" "AddressLabel" NOT NULL DEFAULT 'HOME',
ADD COLUMN     "recipientName" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "recipientPhone" TEXT NOT NULL DEFAULT '';
