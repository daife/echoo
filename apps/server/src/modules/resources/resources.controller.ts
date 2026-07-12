import type { FastifyInstance } from "fastify";
import { ResourceRepository } from "./resource.repository.js";

export async function registerResourceRoutes(app: FastifyInstance) {
  const resources = new ResourceRepository();

  app.get<{ Params: { id: string } }>("/:id/file", async (request, reply) => {
    const resource = await resources.findById(request.params.id);
    if (!resource) {
      return reply.code(404).send({ error: "RESOURCE_NOT_FOUND" });
    }

    reply.header("Content-Type", resource.mimeType);
    reply.header("Cache-Control", "private, max-age=31536000, immutable");
    return reply.send(resources.createReadStream(resource));
  });
}
