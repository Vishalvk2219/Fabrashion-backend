import { z } from '@/lib/zod';
import { requestIdHeader, responses } from '@/docs/components';
import { API_V1, bearerAuth, registry } from '@/docs/registry';
import type { AddressDTO } from './address.mapper';
import { createAddressSchema, updateAddressSchema } from './address.schema';

/** OpenAPI description of the saved-addresses module. Every route requires auth. */

const TAG = 'Addresses';

const secured = [{ [bearerAuth.name]: [] }];
const addressParams = z.object({
  id: z.string().uuid().openapi({ description: 'Address id.', example: 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d' }),
});

const addressExample = {
  id: 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d',
  label: 'HOME',
  recipientName: 'Aarav Sharma',
  recipientPhone: '+919876543210',
  line1: '221B, 4th Cross, Indiranagar',
  line2: 'Near Metro Station',
  city: 'Bengaluru',
  state: 'Karnataka',
  pincode: '560038',
  isDefault: true,
};

export const addressSchema = registry.register(
  'Address',
  z
    .object({
      id: z.string().uuid().openapi({ example: addressExample.id }),
      label: z.enum(['HOME', 'WORK', 'OTHER']).openapi({
        description: 'Shown as a chip in the app. Purely cosmetic.',
        example: 'HOME',
      }),
      recipientName: z.string().openapi({ example: addressExample.recipientName }),
      recipientPhone: z.string().openapi({
        description: 'Who the courier calls — may differ from the account phone.',
        example: addressExample.recipientPhone,
      }),
      line1: z.string().openapi({ example: addressExample.line1 }),
      line2: z.string().nullable().openapi({ example: addressExample.line2 }),
      city: z.string().openapi({ example: addressExample.city }),
      state: z.string().openapi({ example: addressExample.state }),
      pincode: z.string().openapi({
        description: 'Six digits. Determines trial serviceability (`GET /trials/eligibility`).',
        example: addressExample.pincode,
      }),
      isDefault: z.boolean().openapi({
        description: 'Exactly one address is default; setting a new one clears the previous.',
        example: true,
      }),
    })
    .openapi({ description: 'A saved shipping address belonging to the signed-in user.' }),
) satisfies z.ZodType<AddressDTO>;

/** `DELETE` returns the remaining list, so the client never re-fetches. */
const addressListSchema = registry.register(
  'AddressList',
  z.object({ addresses: z.array(addressSchema) }).openapi({
    description: 'The user’s remaining addresses after a delete.',
  }),
);

registry.registerPath({
  method: 'get',
  path: `${API_V1}/addresses`,
  operationId: 'listAddresses',
  tags: [TAG],
  summary: 'List saved addresses',
  security: secured,
  description: 'Every address on the signed-in account, default first.',
  responses: {
    200: {
      description: 'The user’s addresses.',
      headers: requestIdHeader,
      content: { 'application/json': { schema: z.array(addressSchema), example: [addressExample] } },
    },
    401: responses.unauthorized,
    500: responses.internal,
  },
});

registry.registerPath({
  method: 'post',
  path: `${API_V1}/addresses`,
  operationId: 'createAddress',
  tags: [TAG],
  summary: 'Save a new address',
  security: secured,
  description:
    'Adds an address to the signed-in account. The **first** address saved becomes the default automatically; after that, pass `isDefault: true` to promote one.',
  request: {
    body: { required: true, content: { 'application/json': { schema: createAddressSchema } } },
  },
  responses: {
    201: {
      description: 'Created.',
      headers: requestIdHeader,
      content: { 'application/json': { schema: addressSchema, example: addressExample } },
    },
    401: responses.unauthorized,
    422: responses.validation,
    500: responses.internal,
  },
});

registry.registerPath({
  method: 'patch',
  path: `${API_V1}/addresses/{id}`,
  operationId: 'updateAddress',
  tags: [TAG],
  summary: 'Update an address',
  security: secured,
  description:
    'Partial update — send only the fields that changed. Promoting one to `isDefault: true` demotes the previous default in the same transaction.\n\n' +
    'Editing an address does **not** rewrite orders already placed to it: orders store an immutable snapshot of the address at purchase time.',
  request: {
    params: addressParams,
    body: { required: true, content: { 'application/json': { schema: updateAddressSchema } } },
  },
  responses: {
    200: {
      description: 'The updated address.',
      headers: requestIdHeader,
      content: { 'application/json': { schema: addressSchema, example: addressExample } },
    },
    401: responses.unauthorized,
    404: responses.notFound,
    422: responses.validation,
    500: responses.internal,
  },
});

registry.registerPath({
  method: 'delete',
  path: `${API_V1}/addresses/{id}`,
  operationId: 'deleteAddress',
  tags: [TAG],
  summary: 'Delete an address',
  security: secured,
  description:
    'Removes the address and returns the **remaining list**, so the client can render straight from the response without a follow-up `GET`.',
  request: { params: addressParams },
  responses: {
    200: {
      description: 'Deleted; the remaining addresses are returned.',
      headers: requestIdHeader,
      content: { 'application/json': { schema: addressListSchema, example: { addresses: [addressExample] } } },
    },
    401: responses.unauthorized,
    404: responses.notFound,
    500: responses.internal,
  },
});
