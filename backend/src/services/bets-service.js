import { withTransaction } from "../db.js";
import { config } from "../config.js";
import { AppError, assert } from "../utils/errors.js";
import { applyPointDelta } from "./points-service.js";

function computePayout(stakePoints, oddsDecimal) {
  return Math.floor(stakePoints * Number(oddsDecimal));
}

export async function placeBet({ userId, marketId, optionId, stakePoints, idempotencyKey }) {
  assert(
    Number.isInteger(stakePoints),
    "stakePoints must be an integer",
    400,
    "INVALID_STAKE"
  );
  assert(
    stakePoints >= config.betStakeMin && stakePoints <= config.betStakeMax,
    `stakePoints must be between ${config.betStakeMin} and ${config.betStakeMax}`,
    400,
    "INVALID_STAKE"
  );

  return withTransaction(async (client) => {
    const existingBet = await client.query(
      `SELECT id, stake_points, odds_decimal, status
       FROM bets
       WHERE idempotency_key = $1`,
      [idempotencyKey]
    );

    if (existingBet.rowCount > 0) {
      const balanceResult = await client.query(
        "SELECT points_balance FROM users WHERE id = $1",
        [userId]
      );

      return {
        betId: existingBet.rows[0].id,
        status: existingBet.rows[0].status,
        stakePoints: existingBet.rows[0].stake_points,
        oddsDecimal: Number(existingBet.rows[0].odds_decimal),
        pointsBalance: balanceResult.rows[0]?.points_balance ?? 0,
        idempotentReplay: true
      };
    }

    const marketResult = await client.query(
      `SELECT id, status, close_at
       FROM markets
       WHERE id = $1
       FOR UPDATE`,
      [marketId]
    );

    if (marketResult.rowCount === 0) {
      throw new AppError("Market not found", 404, "MARKET_NOT_FOUND");
    }

    const market = marketResult.rows[0];
    if (market.status !== "OPEN") {
      throw new AppError("Market is not open", 409, "MARKET_NOT_OPEN");
    }

    const now = new Date();
    if (new Date(market.close_at) <= now) {
      throw new AppError("Market already closed", 409, "MARKET_CLOSED");
    }

    const optionResult = await client.query(
      `SELECT id, odds_decimal
       FROM market_options
       WHERE id = $1 AND market_id = $2`,
      [optionId, marketId]
    );

    if (optionResult.rowCount === 0) {
      throw new AppError("Option not found for market", 404, "OPTION_NOT_FOUND");
    }

    const oddsDecimal = Number(optionResult.rows[0].odds_decimal);
    const betInsert = await client.query(
      `INSERT INTO bets
        (user_id, market_id, option_id, stake_points, odds_decimal, status, idempotency_key)
       VALUES
        ($1, $2, $3, $4, $5, 'PLACED', $6)
       RETURNING id, status, stake_points, odds_decimal`,
      [userId, marketId, optionId, stakePoints, oddsDecimal, idempotencyKey]
    );

    const bet = betInsert.rows[0];

    const points = await applyPointDelta({
      client,
      userId,
      delta: -stakePoints,
      entryType: "bet_stake",
      refType: "bet",
      refId: bet.id,
      idempotencyKey: `bet-stake:${idempotencyKey}`,
      meta: {
        marketId,
        optionId
      }
    });

    return {
      betId: bet.id,
      status: bet.status,
      stakePoints: bet.stake_points,
      oddsDecimal: Number(bet.odds_decimal),
      pointsBalance: points.balanceAfter,
      idempotentReplay: false
    };
  });
}

export async function settleMarket({ marketId, winnerOptionId, proofUrl, note, actorId = null }) {
  return withTransaction(async (client) => {
    const marketResult = await client.query(
      `SELECT id, status
       FROM markets
       WHERE id = $1
       FOR UPDATE`,
      [marketId]
    );

    if (marketResult.rowCount === 0) {
      throw new AppError("Market not found", 404, "MARKET_NOT_FOUND");
    }

    const market = marketResult.rows[0];
    if (market.status === "SETTLED") {
      throw new AppError("Market already settled", 409, "MARKET_ALREADY_SETTLED");
    }
    if (market.status === "CANCELED") {
      throw new AppError("Canceled market cannot be settled", 409, "MARKET_CANCELED");
    }

    const winnerResult = await client.query(
      `SELECT id
       FROM market_options
       WHERE id = $1 AND market_id = $2`,
      [winnerOptionId, marketId]
    );

    if (winnerResult.rowCount === 0) {
      throw new AppError("Winner option is invalid for this market", 400, "INVALID_WINNER_OPTION");
    }

    await client.query(
      `UPDATE market_options
       SET is_winner = CASE WHEN id = $1 THEN true ELSE false END
       WHERE market_id = $2`,
      [winnerOptionId, marketId]
    );

    await client.query(
      `UPDATE markets
       SET status = 'SETTLED', settle_at = now(), updated_at = now()
       WHERE id = $1`,
      [marketId]
    );

    const betsResult = await client.query(
      `SELECT id, user_id, option_id, stake_points, odds_decimal
       FROM bets
       WHERE market_id = $1 AND status = 'PLACED'
       FOR UPDATE`,
      [marketId]
    );

    let winCount = 0;
    let lossCount = 0;

    for (const bet of betsResult.rows) {
      const isWinner = bet.option_id === winnerOptionId;
      if (!isWinner) {
        await client.query(
          `UPDATE bets
           SET status = 'LOSS', payout_points = 0, settled_at = now()
           WHERE id = $1`,
          [bet.id]
        );
        lossCount += 1;
        continue;
      }

      const payout = computePayout(bet.stake_points, bet.odds_decimal);

      await client.query(
        `UPDATE bets
         SET status = 'WIN', payout_points = $2, settled_at = now()
         WHERE id = $1`,
        [bet.id, payout]
      );

      await applyPointDelta({
        client,
        userId: bet.user_id,
        delta: payout,
        entryType: "bet_payout",
        refType: "bet",
        refId: bet.id,
        idempotencyKey: `settle:${marketId}:bet:${bet.id}:payout`,
        meta: {
          winnerOptionId
        }
      });

      winCount += 1;
    }

    await client.query(
      `INSERT INTO admin_audit_log
        (actor_id, action, target_type, target_id, details)
       VALUES
        ($1, 'SETTLE_MARKET', 'market', $2, $3::jsonb)`,
      [
        actorId,
        marketId,
        JSON.stringify({
          winnerOptionId,
          proofUrl,
          note,
          winCount,
          lossCount
        })
      ]
    );

    return {
      marketId,
      winnerOptionId,
      betsProcessed: betsResult.rowCount,
      winCount,
      lossCount
    };
  });
}
