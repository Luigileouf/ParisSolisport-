import { pool } from "../db.js";
import { getAuthUser } from "../utils/auth.js";
import { AppError } from "../utils/errors.js";

function getSafeLimit(rawLimit, fallback = 50) {
  const limit = Number.parseInt(rawLimit ?? String(fallback), 10);
  return Number.isNaN(limit) ? fallback : Math.max(1, Math.min(limit, 100));
}

export default async function userRoutes(fastify) {
  fastify.get("/me", async (request) => {
    const user = await getAuthUser(request);
    const result = await pool.query(
      `SELECT id, email, display_name, points_balance
       FROM users
       WHERE id = $1`,
      [user.id]
    );

    if (result.rowCount === 0) {
      throw new AppError("User not found", 404, "USER_NOT_FOUND");
    }

    const row = result.rows[0];
    return {
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      pointsBalance: row.points_balance
    };
  });

  fastify.get("/me/ledger", async (request) => {
    const user = await getAuthUser(request);
    const safeLimit = getSafeLimit(request.query.limit, 50);

    const result = await pool.query(
      `SELECT id, entry_type, points_delta, balance_after, ref_type, ref_id, created_at
       FROM point_ledger
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [user.id, safeLimit]
    );

    return {
      items: result.rows.map((row) => ({
        id: row.id,
        entryType: row.entry_type,
        pointsDelta: row.points_delta,
        balanceAfter: row.balance_after,
        refType: row.ref_type,
        refId: row.ref_id,
        createdAt: row.created_at
      }))
    };
  });

  fastify.get("/me/history", async (request) => {
    const user = await getAuthUser(request);
    const safeLimit = getSafeLimit(request.query.limit, 20);

    const [betsResult, ledgerResult, redemptionsResult] = await Promise.all([
      pool.query(
        `SELECT b.id, b.market_id, b.option_id, b.stake_points, b.odds_decimal, b.payout_points, b.status, b.placed_at, b.settled_at
         FROM bets b
         WHERE b.user_id = $1
         ORDER BY b.placed_at DESC
         LIMIT $2`,
        [user.id, safeLimit]
      ),
      pool.query(
        `SELECT id, entry_type, points_delta, balance_after, ref_type, ref_id, created_at
         FROM point_ledger
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [user.id, safeLimit]
      ),
      pool.query(
        `SELECT rr.id, rr.reward_id, rr.points_spent, rr.code, rr.status, rr.fulfilled_at, rr.created_at,
                pr.partner_name, pr.title
         FROM reward_redemptions rr
         LEFT JOIN partner_rewards pr ON pr.id = rr.reward_id
         WHERE rr.user_id = $1
         ORDER BY rr.created_at DESC
         LIMIT $2`,
        [user.id, safeLimit]
      )
    ]);

    return {
      limit: safeLimit,
      bets: betsResult.rows.map((row) => ({
        id: row.id,
        marketId: row.market_id,
        optionId: row.option_id,
        stakePoints: row.stake_points,
        oddsDecimal: Number(row.odds_decimal),
        payoutPoints: row.payout_points,
        status: row.status,
        placedAt: row.placed_at,
        settledAt: row.settled_at
      })),
      ledger: ledgerResult.rows.map((row) => ({
        id: row.id,
        entryType: row.entry_type,
        pointsDelta: row.points_delta,
        balanceAfter: row.balance_after,
        refType: row.ref_type,
        refId: row.ref_id,
        createdAt: row.created_at
      })),
      redemptions: redemptionsResult.rows.map((row) => ({
        id: row.id,
        rewardId: row.reward_id,
        partnerName: row.partner_name,
        rewardTitle: row.title,
        pointsSpent: row.points_spent,
        code: row.code,
        status: row.status,
        fulfilledAt: row.fulfilled_at,
        createdAt: row.created_at
      }))
    };
  });

  fastify.get("/me/bets", async (request) => {
    const user = await getAuthUser(request);
    const status = request.query.status;

    const values = [user.id];
    let where = "WHERE b.user_id = $1";
    if (status) {
      values.push(status);
      where += ` AND b.status = $${values.length}`;
    }

    const result = await pool.query(
      `SELECT b.id, b.market_id, b.option_id, b.stake_points, b.odds_decimal, b.payout_points, b.status, b.placed_at, b.settled_at
       FROM bets b
       ${where}
       ORDER BY b.placed_at DESC
       LIMIT 100`,
      values
    );

    return {
      items: result.rows.map((row) => ({
        id: row.id,
        marketId: row.market_id,
        optionId: row.option_id,
        stakePoints: row.stake_points,
        oddsDecimal: Number(row.odds_decimal),
        payoutPoints: row.payout_points,
        status: row.status,
        placedAt: row.placed_at,
        settledAt: row.settled_at
      }))
    };
  });
}
