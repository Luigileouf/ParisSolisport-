import { pool } from "../db.js";
import { getAuthUser } from "../utils/auth.js";
import { requireIdempotencyKey } from "../utils/idempotency.js";
import { redeemReward } from "../services/rewards-service.js";

export default async function rewardRoutes(fastify) {
  fastify.get("/rewards", async () => {
    const result = await pool.query(
      `SELECT id, partner_name, title, description, points_cost, stock, is_active
       FROM partner_rewards
       WHERE is_active = true
       ORDER BY points_cost ASC`
    );

    return {
      items: result.rows.map((row) => ({
        id: row.id,
        partnerName: row.partner_name,
        title: row.title,
        description: row.description,
        pointsCost: row.points_cost,
        stock: row.stock,
        isActive: row.is_active
      }))
    };
  });

  fastify.post("/rewards/:rewardId/redeem", async (request, reply) => {
    const user = await getAuthUser(request);
    const idempotencyKey = requireIdempotencyKey(request);
    const { rewardId } = request.params;

    const result = await redeemReward({
      userId: user.id,
      rewardId,
      idempotencyKey
    });

    reply.code(result.idempotentReplay ? 200 : 201);
    return {
      redemptionId: result.redemptionId,
      status: result.status,
      pointsSpent: result.pointsSpent,
      code: result.code,
      pointsBalance: result.pointsBalance
    };
  });
}
