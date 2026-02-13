import { pool } from "../db.js";
import { AppError } from "../utils/errors.js";
import { creditAdReward } from "../services/ad-reward-service.js";

function validateCallback({ watched, signature }) {
  if (!signature) {
    throw new AppError("Missing callback signature", 401, "INVALID_CALLBACK_SIGNATURE");
  }
  if (!watched) {
    throw new AppError("Ad was not fully watched", 400, "AD_NOT_COMPLETED");
  }
}

export default async function adRoutes(fastify) {
  fastify.post("/ads/reward-callback", async (request) => {
    const {
      network,
      networkEventId,
      userExternalId,
      watched,
      signature,
      idempotencyKey
    } = request.body ?? {};

    validateCallback({ watched, signature });

    if (!network || !networkEventId || !userExternalId) {
      throw new AppError(
        "network, networkEventId and userExternalId are required",
        400,
        "INVALID_PAYLOAD"
      );
    }

    const userCheck = await pool.query(
      "SELECT id FROM users WHERE id = $1",
      [userExternalId]
    );
    if (userCheck.rowCount === 0) {
      throw new AppError("User not found", 404, "USER_NOT_FOUND");
    }

    const rewardResult = await creditAdReward({
      userId: userExternalId,
      network,
      networkEventId,
      idempotencyKey: idempotencyKey || `${network}:${networkEventId}`
    });

    return rewardResult;
  });
}
