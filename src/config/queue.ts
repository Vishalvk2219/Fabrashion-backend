import { Queue, type ConnectionOptions } from 'bullmq';
import { env } from '@/config/env';

/**
 * BullMQ queue registry. Queues are created lazily via `getQueue(name)` so no
 * Redis connection opens until a queue is actually used (workers land in later
 * phases).
 *
 * We pass BullMQ a plain connection-options object (parsed from REDIS_URL)
 * rather than a shared ioredis instance: BullMQ bundles its own ioredis and
 * requires `maxRetriesPerRequest: null`, so giving it its own connection keeps
 * types clean and avoids interfering with the cache client in config/redis.ts.
 */
export const QUEUE_NAMES = {
  INVENTORY_SYNC: 'inventory-sync',
  PAYMENT: 'payment',
  NOTIFICATION: 'notification',
  TRIAL: 'trial',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

const redisUrl = new URL(env.REDIS_URL);

export const queueConnection: ConnectionOptions = {
  host: redisUrl.hostname,
  port: redisUrl.port ? Number(redisUrl.port) : 6379,
  username: redisUrl.username || undefined,
  password: redisUrl.password || undefined,
  // BullMQ workers require this to be null.
  maxRetriesPerRequest: null,
};

const queues = new Map<QueueName, Queue>();

export function getQueue(name: QueueName): Queue {
  let queue = queues.get(name);
  if (!queue) {
    queue = new Queue(name, { connection: queueConnection });
    queues.set(name, queue);
  }
  return queue;
}
