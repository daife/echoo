import type { Message } from "@echoo/shared";
import { getRedis } from "./redis.js";

export interface CachedMessage {
  sequence: number;
  message: Message;
}

const UPSERT_SCRIPT = `
local existing = redis.call('ZRANGEBYSCORE', KEYS[1], ARGV[1], ARGV[1])
if #existing > 0 then redis.call('ZREM', KEYS[1], unpack(existing)) end
redis.call('ZADD', KEYS[1], ARGV[1], ARGV[2])
redis.call('ZREMRANGEBYRANK', KEYS[1], 0, -(tonumber(ARGV[3]) + 1))
redis.call('PEXPIRE', KEYS[1], ARGV[4])
if redis.call('EXISTS', KEYS[2]) == 1 then
  redis.call('PEXPIRE', KEYS[2], ARGV[4])
end
return 1
`;

export class MessageCache {
  private readonly maximum = Math.max(
    1,
    Math.trunc(Number(process.env.MESSAGE_CACHE_MAX_PER_CONVERSATION ?? 500)),
  );
  private readonly ttlMs = Math.max(
    60_000,
    Number(process.env.MESSAGE_CACHE_TTL_MS ?? 6 * 60 * 60_000),
  );

  async getRecent(
    ownerUserId: string,
    conversationId: string,
    limit: number,
  ): Promise<CachedMessage[] | null> {
    if (limit > this.maximum) return null;
    const redis = await getRedis();
    const meta = await redis.get(this.metaKey(ownerUserId, conversationId));
    if (!meta) return null;
    const coverage = parseCoverage(meta);
    if (!coverage.complete && coverage.covered < limit) return null;
    const values = await redis.zRange(
      this.dataKey(ownerUserId, conversationId),
      -limit,
      -1,
    );
    const cached = values.map(parseCachedMessage).filter(isCachedMessage);
    if (!cached.length) return cached;
    const live = await redis.hmGet(
      this.liveKey(ownerUserId, conversationId),
      cached.map((item) => item.message.id),
    );
    return cached.map((item, index) => {
      const liveMessage = live[index] ? parseMessage(live[index] as string) : null;
      return liveMessage ? { ...item, message: liveMessage } : item;
    });
  }

  async replaceRecent(
    ownerUserId: string,
    conversationId: string,
    messages: CachedMessage[],
    requestedLimit: number,
  ) {
    const redis = await getRedis();
    const dataKey = this.dataKey(ownerUserId, conversationId);
    const metaKey = this.metaKey(ownerUserId, conversationId);
    const retained = messages.slice(-this.maximum);
    const transaction = redis.multi().del(dataKey);
    if (retained.length)
      transaction.zAdd(
        dataKey,
        retained.map((item) => ({
          score: item.sequence,
          value: JSON.stringify(item),
        })),
      );
    transaction
      .pExpire(dataKey, this.ttlMs)
      .set(
        metaKey,
        JSON.stringify({
          covered: Math.min(requestedLimit, this.maximum),
          complete: messages.length < requestedLimit,
        }),
        { PX: this.ttlMs },
      );
    await transaction.exec();
  }

  async upsert(
    ownerUserId: string,
    conversationId: string,
    item: CachedMessage,
  ) {
    const redis = await getRedis();
    await redis.eval(UPSERT_SCRIPT, {
      keys: [
        this.dataKey(ownerUserId, conversationId),
        this.metaKey(ownerUserId, conversationId),
      ],
      arguments: [
        String(item.sequence),
        JSON.stringify(item),
        String(this.maximum),
        String(this.ttlMs),
      ],
    });
    await redis.hDel(this.liveKey(ownerUserId, conversationId), item.message.id);
  }

  async updateLive(ownerUserId: string, conversationId: string, message: Message) {
    const redis = await getRedis();
    const key = this.liveKey(ownerUserId, conversationId);
    await redis.hSet(key, message.id, JSON.stringify(message));
    await redis.pExpire(key, this.ttlMs);
  }

  async invalidate(ownerUserId: string, conversationId: string) {
    const redis = await getRedis();
    await redis.del([
      this.dataKey(ownerUserId, conversationId),
      this.metaKey(ownerUserId, conversationId),
      this.liveKey(ownerUserId, conversationId),
    ]);
  }

  private dataKey(ownerUserId: string, conversationId: string) {
    return `echoo:messages:recent:${ownerUserId}:${conversationId}`;
  }

  private metaKey(ownerUserId: string, conversationId: string) {
    return `echoo:messages:recent-meta:${ownerUserId}:${conversationId}`;
  }


  private liveKey(ownerUserId: string, conversationId: string) {
    return `echoo:messages:live:${ownerUserId}:${conversationId}`;
  }
}

function parseCachedMessage(value: string): CachedMessage | null {
  try {
    const parsed = JSON.parse(value) as CachedMessage;
    return typeof parsed.sequence === "number" && parsed.message ? parsed : null;
  } catch {
    return null;
  }
}

function isCachedMessage(value: CachedMessage | null): value is CachedMessage {
  return value !== null;
}

function parseMessage(value: string): Message | null {
  try {
    const parsed = JSON.parse(value) as Message;
    return parsed?.id ? parsed : null;
  } catch {
    return null;
  }
}

function parseCoverage(value: string) {
  try {
    const parsed = JSON.parse(value) as { covered?: unknown; complete?: unknown };
    return {
      covered: typeof parsed.covered === "number" ? parsed.covered : 0,
      complete: parsed.complete === true,
    };
  } catch {
    return { covered: 0, complete: false };
  }
}
