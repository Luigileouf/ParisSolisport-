import { withTransaction } from "../db.js";
import { config } from "../config.js";
import { AppError } from "../utils/errors.js";
import { applyPointDelta } from "./points-service.js";

export async function creditAdReward({
  userId,
  network,
  networkEventId,
  idempotencyKey,
  pointsGranted = config.adRewardPoints
}) {
  return withTransaction(async (client) => {
    const duplicateByNetworkEvent = await client.query(
      `SELECT id, user_id, points_granted, validated
       FROM ad_reward_events
       WHERE ad_network = $1 AND network_event_id = $2`,
      [network, networkEventId]
    );

    if (duplicateByNetworkEvent.rowCount > 0) {
      const balanceResult = await client.query(
        "SELECT points_balance FROM users WHERE id = $1",
        [duplicateByNetworkEvent.rows[0].user_id]
      );
      return {
        accepted: true,
        alreadyProcessed: true,
        pointsGranted: duplicateByNetworkEvent.rows[0].points_granted,
        pointsBalance: balanceResult.rows[0]?.points_balance ?? 0
      };
    }

    const duplicateByIdempotency = await client.query(
      `SELECT id, user_id, points_granted
       FROM ad_reward_events
       WHERE idempotency_key = $1`,
      [idempotencyKey]
    );

    if (duplicateByIdempotency.rowCount > 0) {
      const balanceResult = await client.query(
        "SELECT points_balance FROM users WHERE id = $1",
        [duplicateByIdempotency.rows[0].user_id]
      );
      return {
        accepted: true,
        alreadyProcessed: true,
        pointsGranted: duplicateByIdempotency.rows[0].points_granted,
        pointsBalance: balanceResult.rows[0]?.points_balance ?? 0
      };
    }

    const dailyCapResult = await client.query(
      `SELECT
         COUNT(*)::int AS watched_count,
         COALESCE(SUM(points_granted), 0)::int AS granted_sum
       FROM ad_reward_events
       WHERE user_id = $1
         AND validated = true
         AND created_at >= date_trunc('day', now())`,
      [userId]
    );

    const watchedCount = dailyCapResult.rows[0].watched_count;
    const grantedSum = dailyCapResult.rows[0].granted_sum;

    if (watchedCount >= config.adRewardMaxPerDay) {
      throw new AppError("Daily ad reward limit reached", 429, "AD_DAILY_LIMIT_REACHED");
    }
    if (grantedSum + pointsGranted > config.adRewardMaxPointsPerDay) {
      throw new AppError(
        "Daily ad points limit reached",
        429,
        "AD_DAILY_POINTS_LIMIT_REACHED"
      );
    }

    const eventInsert = await client.query(
      `INSERT INTO ad_reward_events
        (user_id, ad_network, network_event_id, points_granted, validated, idempotency_key)
       VALUES
        ($1, $2, $3, $4, true, $5)
       RETURNING id, points_granted`,
      [userId, network, networkEventId, pointsGranted, idempotencyKey]
    );

    const points = await applyPointDelta({
      client,
      userId,
      delta: pointsGranted,
      entryType: "ad_reward",
      refType: "ad_reward_event",
      refId: eventInsert.rows[0].id,
      idempotencyKey: `ad-reward:${idempotencyKey}`,
      meta: {
        network,
        networkEventId
      }
    });

    return {
      accepted: true,
      alreadyProcessed: false,
      pointsGranted,
      pointsBalance: points.balanceAfter
    };
  });
}
