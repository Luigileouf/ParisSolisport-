import { pool } from "../db.js";
import { getAuthUser } from "../utils/auth.js";
import { AppError } from "../utils/errors.js";

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
    const limit = Number.parseInt(request.query.limit ?? "50", 10);
    const safeLimit = Number.isNaN(limit) ? 50 : Math.max(1, Math.min(limit, 100));

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
