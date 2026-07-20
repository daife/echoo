import type { FastifyPluginAsync } from "fastify";
import { channelsController } from "./channels.controller.js";

export const channelsModule: FastifyPluginAsync = async (fastify) => {
  await fastify.register(channelsController, { prefix: "/channels" });
};
