import type { FastifyInstance, FastifyReply } from "fastify";
import { ZodError } from "zod";
import { AuthError, AuthService } from "./auth.service.js";
import { InvalidMediaUploadError } from "../resources/resource.repository.js";
import type {
  ForgotPasswordBody,
  LoginBody,
  RegisterBody,
  ResetPasswordBody,
  VerifyEmailBody,
  UpdateUserProfileBody,
} from "./auth.types.js";

export async function registerAuthRoutes(app: FastifyInstance) {
  const authService = new AuthService(app);

  app.post<{ Body: RegisterBody }>("/register", async (request, reply) => {
    try {
      return await authService.register(request.body);
    } catch (error) {
      return sendAuthError(reply, error);
    }
  });

  app.post<{ Body: LoginBody }>("/login", async (request, reply) => {
    try {
      return await authService.login(request.body);
    } catch (error) {
      return sendAuthError(reply, error);
    }
  });

  app.get("/me", async (request, reply) => {
    const userId = await request.requireUserId(reply);
    if (!userId) return;
    return authService.me(userId);
  });

  app.patch<{ Body: UpdateUserProfileBody }>(
    "/me",
    { bodyLimit: 8 * 1024 * 1024 },
    async (request, reply) => {
      const userId = await request.requireUserId(reply);
      if (!userId) return;
      try {
        return await authService.updateProfile(userId, request.body);
      } catch (error) {
        return sendAuthError(reply, error);
      }
    },
  );

  app.post<{ Body: ForgotPasswordBody }>(
    "/password/forgot",
    async (request, reply) => {
      try {
        return await authService.forgotPassword(request.body);
      } catch (error) {
        return sendAuthError(reply, error);
      }
    },
  );

  app.post<{ Body: ResetPasswordBody }>(
    "/password/reset",
    async (request, reply) => {
      try {
        return await authService.resetPassword(request.body);
      } catch (error) {
        return sendAuthError(reply, error);
      }
    },
  );

  app.post<{ Body: VerifyEmailBody }>(
    "/email/verify",
    async (request, reply) => {
      try {
        return await authService.verifyEmail(request.body);
      } catch (error) {
        return sendAuthError(reply, error);
      }
    },
  );
}

function sendAuthError(reply: FastifyReply, error: unknown) {
  if (error instanceof AuthError) {
    return reply
      .code(error.statusCode)
      .send({ error: error.code, message: error.message });
  }

  if (error instanceof ZodError) {
    return reply.code(400).send({
      error: "VALIDATION_ERROR",
      message: error.issues[0]?.message ?? "输入无效。",
    });
  }

  if (error instanceof InvalidMediaUploadError)
    return reply
      .code(400)
      .send({ error: "INVALID_MEDIA_UPLOAD", message: error.message });

  throw error;
}
