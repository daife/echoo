import type { FastifyPluginAsync } from "fastify";
import { OpenClawService } from "./openclaw.service.js";

export const openclawController: FastifyPluginAsync = async (fastify) => {
  const service = new OpenClawService();

  fastify.addHook("preHandler", async (request, reply) => {
    const auth = request.headers.authorization;
    if (!auth || !auth.startsWith("Bearer ")) {
      return reply.code(401).send({ ret: -1, errmsg: "Unauthorized" });
    }
    const token = auth.substring(7);
    (request as any).openclawToken = token;
  });

  fastify.post<{ Body: { get_updates_buf: string } }>("/getupdates", async (request, reply) => {
    const token = (request as any).openclawToken;
    const result = await service.getUpdates(token, request.body.get_updates_buf);
    return result;
  });

  fastify.post<{ Body: { msg: any } }>("/sendmessage", async (request, reply) => {
    const token = (request as any).openclawToken;
    const uin = request.headers["x-wechat-uin"] as string;
    const result = await service.processIncomingMessage(token, request.body.msg, uin);
    return result;
  });

  fastify.post("/getuploadurl", async (request, reply) => {
    // Return dummy params as full CDN integration requires the encryption keys from OpenClaw setup
    return {
      upload_param: "dummy_param",
      thumb_upload_param: "dummy_thumb_param",
    };
  });

  fastify.post("/getconfig", async (request, reply) => {
    return {
      ret: 0,
      typing_ticket: "dummy_typing_ticket",
    };
  });

  fastify.post("/sendtyping", async (request, reply) => {
    return { ret: 0 };
  });
};
