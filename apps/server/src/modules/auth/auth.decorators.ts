import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

declare module "fastify" {
  interface FastifyRequest {
    requireUserId(reply: FastifyReply): Promise<string | null>;
  }
}

export function registerAuthDecorators(app: FastifyInstance) {
  app.decorateRequest("requireUserId", async function (this: FastifyRequest, reply: FastifyReply) {
    try {
      const payload = await this.jwtVerify<{ sub: string }>();
      return payload.sub;
    } catch {
      reply.code(401).send({ error: "UNAUTHORIZED", message: "请重新登录。" });
      return null;
    }
  });
}
