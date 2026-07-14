import type { Address } from '@prisma/client';

export interface AddressDTO {
  id: string;
  label: Address['label'];
  recipientName: string;
  recipientPhone: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  pincode: string;
  isDefault: boolean;
}

export function toAddress(a: Address): AddressDTO {
  return {
    id: a.id,
    label: a.label,
    recipientName: a.recipientName,
    recipientPhone: a.recipientPhone,
    line1: a.line1,
    line2: a.line2,
    city: a.city,
    state: a.state,
    pincode: a.pincode,
    isDefault: a.isDefault,
  };
}
