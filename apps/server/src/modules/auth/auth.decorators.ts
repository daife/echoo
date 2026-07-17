import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

declare module "fastify" {
  interface FastifyRequest {
    optionalUserId(): Promise<string | null>;
    requireUserId(reply: FastifyReply): Promise<string | null>;
    requireAdmin(reply: FastifyReply): Promise<boolean>;
  }
}

export function registerAuthDecorators(app: FastifyInstance) {
  app.decorateRequest("optionalUserId", async function (this: FastifyRequest) {
    try {
      const payload = await this.jwtVerify<{ sub: string }>();
      return payload.sub;
    } catch {
      return null;
    }
  });
  app.decorateRequest(
    "requireUserId",
    async function (this: FastifyRequest, reply: FastifyReply) {
      try {
        const payload = await this.jwtVerify<{ sub: string }>();
        return payload.sub;
      } catch {
        reply
          .code(401)
          .send({ error: "UNAUTHORIZED", message: "请重新登录。" });
        return null;
      }
    },
  );
  app.decorateRequest(
    "requireAdmin",
    async function (this: FastifyRequest, reply: FastifyReply) {
      try {
        const payload = await this.jwtVerify<{ type?: string }>();
        if (payload.type !== "admin") throw new Error("not admin");
        return true;
      } catch {
        reply
          .code(401)
          .send({ error: "ADMIN_UNAUTHORIZED", message: "管理员登录已失效。" });
        return false;
      }
    },
  );
}
