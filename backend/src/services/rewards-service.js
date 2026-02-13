import crypto from "node:crypto";
import { withTransaction } from "../db.js";
import { AppError } from "../utils/errors.js";
import { applyPointDelta } from "./points-service.js";

function createRewardCode() {
  return `REWARD-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

export async function redeemReward({ userId, rewardId, idempotencyKey }) {
  return withTransaction(async (client) => {
    const existing = await client.query(
      `SELECT id, status, points_spent, code
       FROM reward_redemptions
       WHERE idempotency_key = $1`,
      [idempotencyKey]
    );

    if (existing.rowCount > 0) {
      const balanceResult = await client.query(
        "SELECT points_balance FROM users WHERE id = $1",
        [userId]
      );

      return {
        redemptionId: existing.rows[0].id,
        status: existing.rows[0].status,
        pointsSpent: existing.rows[0].points_spent,
        code: existing.rows[0].code,
        pointsBalance: balanceResult.rows[0]?.points_balance ?? 0,
        idempotentReplay: true
      };
    }

    const rewardResult = await client.query(
      `SELECT id, partner_name, title, points_cost, stock, is_active
       FROM partner_rewards
       WHERE id = $1
       FOR UPDATE`,
      [rewardId]
    );

    if (rewardResult.rowCount === 0) {
      throw new AppError("Reward not found", 404, "REWARD_NOT_FOUND");
    }

    const reward = rewardResult.rows[0];
    if (!reward.is_active) {
      throw new AppError("Reward is inactive", 409, "REWARD_INACTIVE");
    }
    if (reward.stock <= 0) {
      throw new AppError("Reward out of stock", 409, "REWARD_OUT_OF_STOCK");
    }

    const code = createRewardCode();
    const redemptionInsert = await client.query(
      `INSERT INTO reward_redemptions
        (user_id, reward_id, points_spent, code, status, idempotency_key, fulfilled_at)
       VALUES
        ($1, $2, $3, $4, 'FULFILLED', $5, now())
       RETURNING id, status, points_spent, code`,
      [userId, rewardId, reward.points_cost, code, idempotencyKey]
    );

    await client.query(
      `UPDATE partner_rewards
       SET stock = stock - 1, updated_at = now()
       WHERE id = $1`,
      [rewardId]
    );

    const points = await applyPointDelta({
      client,
      userId,
      delta: -reward.points_cost,
      entryType: "reward_redeem",
      refType: "redemption",
      refId: redemptionInsert.rows[0].id,
      idempotencyKey: `reward-redeem:${idempotencyKey}`,
      meta: {
        rewardId,
        partnerName: reward.partner_name,
        rewardTitle: reward.title
      }
    });

    return {
      redemptionId: redemptionInsert.rows[0].id,
      status: redemptionInsert.rows[0].status,
      pointsSpent: redemptionInsert.rows[0].points_spent,
      code: redemptionInsert.rows[0].code,
      pointsBalance: points.balanceAfter,
      idempotentReplay: false
    };
  });
}
