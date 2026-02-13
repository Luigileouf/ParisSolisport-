import { getAuthUser } from "../utils/auth.js";
import { requireIdempotencyKey } from "../utils/idempotency.js";
import { placeBet } from "../services/bets-service.js";

export default async function betRoutes(fastify) {
  fastify.post("/bets", async (request, reply) => {
    const user = await getAuthUser(request);
    const idempotencyKey = requireIdempotencyKey(request);

    const { marketId, optionId, stakePoints } = request.body ?? {};
    const result = await placeBet({
      userId: user.id,
      marketId,
      optionId,
      stakePoints: Number(stakePoints),
      idempotencyKey
    });

    reply.code(result.idempotentReplay ? 200 : 201);
    return {
      betId: result.betId,
      status: result.status,
      stakePoints: result.stakePoints,
      oddsDecimal: result.oddsDecimal,
      pointsBalance: result.pointsBalance
    };
  });
}
