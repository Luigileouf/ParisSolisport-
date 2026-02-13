import Fastify from "fastify";
import fastifyJwt from "@fastify/jwt";
import { config } from "./config.js";
import { AppError } from "./utils/errors.js";
import { pool } from "./db.js";

import healthRoutes from "./routes/health-routes.js";
import authRoutes from "./routes/auth-routes.js";
import userRoutes from "./routes/user-routes.js";
import marketRoutes from "./routes/market-routes.js";
import betRoutes from "./routes/bet-routes.js";
import rewardRoutes from "./routes/reward-routes.js";
import adRoutes from "./routes/ad-routes.js";
import adminRoutes from "./routes/admin-routes.js";

export function buildApp() {
  const fastify = Fastify({
    logger: {
      level: config.logLevel
    }
  });

  fastify.decorate("pg", pool);
  fastify.register(fastifyJwt, {
    secret: config.jwtSecret
  });

  fastify.setErrorHandler((error, request, reply) => {
    request.log.error(error);

    if (error instanceof AppError) {
      reply.code(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          requestId: request.id,
          details: error.details
        }
      });
      return;
    }

    if (error.code === "23505") {
      reply.code(409).send({
        error: {
          code: "CONFLICT",
          message: "Resource conflict",
          requestId: request.id
        }
      });
      return;
    }

    reply.code(500).send({
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "Unexpected server error",
        requestId: request.id
      }
    });
  });

  fastify.register(healthRoutes, { prefix: "/api/v1" });
  fastify.register(authRoutes, { prefix: "/api/v1" });
  fastify.register(userRoutes, { prefix: "/api/v1" });
  fastify.register(marketRoutes, { prefix: "/api/v1" });
  fastify.register(betRoutes, { prefix: "/api/v1" });
  fastify.register(rewardRoutes, { prefix: "/api/v1" });
  fastify.register(adRoutes, { prefix: "/api/v1" });
  fastify.register(adminRoutes, { prefix: "/api/v1" });

  return fastify;
}
