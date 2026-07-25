import { randomUUID } from "node:crypto";
import { createVoiceCloneSchema } from "@echoo/shared/voice-clones";
import type { FastifyInstance, FastifyReply } from "fastify";
import { getRedis } from "../../infra/redis/redis.js";
import { FishAudioVoiceCloneError } from "./fish-audio-voice-clone.service.js";
import {
  VoiceCloneNotFoundError,
  VoiceCloneQuotaError,
  VoiceCloneSampleError,
  VoiceCloneService,
} from "./voice-clone.service.js";

export async function registerVoiceCloneRoutes(app: FastifyInstance) {
  const clones = new VoiceCloneService();

  app.get("/voice-clones", async (request, reply) => {
    const userId = await request.requireUserId(reply);
    if (!userId) return;
    return clones.list(userId);
  });

  app.post<{ Body: unknown }>("/voice-clones", async (request, reply) => {
    const userId = await request.requireUserId(reply);
    if (!userId) return;
    const parsed = createVoiceCloneSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({
        error: "VALIDATION_ERROR",
        message: parsed.error.issues[0]?.message,
      });
    if (!(await allowCreate(userId)))
      return reply.code(429).send({
        error: "VOICE_CLONE_RATE_LIMITED",
        message: "每小时最多创建 3 次音色克隆，请稍后再试。",
      });
    try {
      return reply.code(201).send(await clones.create(userId, parsed.data));
    } catch (error) {
      return voiceCloneError(reply, error);
    }
  });

  app.delete<{ Params: { id: string } }>("/voice-clones/:id", async (request, reply) => {
    const userId = await request.requireUserId(reply);
    if (!userId) return;
    try {
      await clones.delete(userId, request.params.id);
      return { deleted: true as const };
    } catch (error) {
      return voiceCloneError(reply, error);
    }
  });
}

async function allowCreate(userId: string) {
  try {
    const redis = await getRedis();
    const now = Date.now();
    const windowMs = 60 * 60_000;
    const count = await redis.eval(
      `redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1] - ARGV[2])
       redis.call('ZADD', KEYS[1], ARGV[1], ARGV[3])
       local count = redis.call('ZCARD', KEYS[1])
       redis.call('PEXPIRE', KEYS[1], ARGV[2])
       return count`,
      {
        keys: [`echoo:rate:voice-clone-create:${userId}`],
        arguments: [String(now), String(windowMs), `${now}:${randomUUID()}`],
      },
    );
    return Number(count) <= 3;
  } catch {
    return true;
  }
}

function voiceCloneError(reply: FastifyReply, error: unknown) {
  if (error instanceof VoiceCloneNotFoundError)
    return reply.code(404).send({ error: "VOICE_CLONE_NOT_FOUND", message: error.message });
  if (error instanceof VoiceCloneQuotaError)
    return reply.code(409).send({ error: "VOICE_CLONE_QUOTA_EXCEEDED", message: error.message });
  if (error instanceof VoiceCloneSampleError)
    return reply.code(400).send({ error: "INVALID_VOICE_CLONE_SAMPLE", message: error.message });
  if (error instanceof FishAudioVoiceCloneError)
    return reply.code(502).send({ error: "FISH_AUDIO_ERROR", message: error.message });
  throw error;
}
