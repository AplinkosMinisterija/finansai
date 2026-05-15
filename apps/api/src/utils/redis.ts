/**
 * Redis singleton'as session storage'ui.
 */
import Redis from 'ioredis';

let redis: Redis | null = null;

export function getRedis(): Redis {
  if (!redis) {
    const url = process.env.REDIS_URL || 'redis://localhost:6380';
    redis = new Redis(url, {
      // Lazy connect, kad testai galėtų suvaldyti lifetime'ą.
      lazyConnect: true,
      maxRetriesPerRequest: 3,
    });
  }
  return redis;
}

export async function closeRedis(): Promise<void> {
  if (redis) {
    redis.disconnect();
    redis = null;
  }
}
