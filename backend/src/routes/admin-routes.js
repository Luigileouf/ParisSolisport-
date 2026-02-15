import { withTransaction } from "../db.js";
import { requireAdmin } from "../utils/auth.js";
import { AppError } from "../utils/errors.js";
import { settleMarket } from "../services/bets-service.js";

function getSafeLimit(rawLimit, fallback = 50) {
  const limit = Number.parseInt(rawLimit ?? String(fallback), 10);
  return Number.isNaN(limit) ? fallback : Math.max(1, Math.min(limit, 100));
}

function getSafeOffset(rawOffset, fallback = 0) {
  const offset = Number.parseInt(rawOffset ?? String(fallback), 10);
  return Number.isNaN(offset) ? fallback : Math.max(0, offset);
}

export default async function adminRoutes(fastify) {
  fastify.get("/admin/summary", async (request) => {
    await requireAdmin(request);

    const [
      usersResult,
      marketsResult,
      betsResult,
      rewardsResult,
      redemptionsResult,
      adsResult,
      ledgerResult
    ] = await Promise.all([
      fastify.pg.query(
        `SELECT COUNT(*)::int AS total
         FROM users`
      ),
      fastify.pg.query(
        `SELECT
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE status = 'DRAFT')::int AS draft,
           COUNT(*) FILTER (WHERE status = 'OPEN')::int AS open,
           COUNT(*) FILTER (WHERE status = 'LOCKED')::int AS locked,
           COUNT(*) FILTER (WHERE status = 'SETTLED')::int AS settled,
           COUNT(*) FILTER (WHERE status = 'CANCELED')::int AS canceled
         FROM markets`
      ),
      fastify.pg.query(
        `SELECT
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE status = 'PLACED')::int AS placed,
           COUNT(*) FILTER (WHERE status = 'WIN')::int AS win,
           COUNT(*) FILTER (WHERE status = 'LOSS')::int AS loss,
           COUNT(*) FILTER (WHERE status = 'VOID')::int AS void,
           COALESCE(SUM(stake_points), 0)::int AS total_stake_points,
           COALESCE(SUM(payout_points), 0)::int AS total_payout_points
         FROM bets`
      ),
      fastify.pg.query(
        `SELECT
           COUNT(*)::int AS catalog_total,
           COUNT(*) FILTER (WHERE is_active = true)::int AS active_catalog
         FROM partner_rewards`
      ),
      fastify.pg.query(
        `SELECT
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE status = 'FULFILLED')::int AS fulfilled,
           COALESCE(SUM(points_spent), 0)::int AS total_points_spent
         FROM reward_redemptions`
      ),
      fastify.pg.query(
        `SELECT
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE validated = true)::int AS validated,
           COALESCE(SUM(points_granted), 0)::int AS points_granted_total
         FROM ad_reward_events`
      ),
      fastify.pg.query(
        `SELECT
           COUNT(*)::int AS entries_total,
           COALESCE(SUM(points_delta), 0)::int AS net_delta,
           COALESCE(SUM(CASE WHEN points_delta > 0 THEN points_delta ELSE 0 END), 0)::int AS credits_total,
           COALESCE(SUM(CASE WHEN points_delta < 0 THEN -points_delta ELSE 0 END), 0)::int AS debits_total
         FROM point_ledger`
      )
    ]);

    const users = usersResult.rows[0];
    const markets = marketsResult.rows[0];
    const bets = betsResult.rows[0];
    const rewards = rewardsResult.rows[0];
    const redemptions = redemptionsResult.rows[0];
    const ads = adsResult.rows[0];
    const ledger = ledgerResult.rows[0];

    return {
      generatedAt: new Date().toISOString(),
      users: {
        total: users.total
      },
      markets: {
        total: markets.total,
        draft: markets.draft,
        open: markets.open,
        locked: markets.locked,
        settled: markets.settled,
        canceled: markets.canceled
      },
      bets: {
        total: bets.total,
        placed: bets.placed,
        win: bets.win,
        loss: bets.loss,
        void: bets.void,
        totalStakePoints: bets.total_stake_points,
        totalPayoutPoints: bets.total_payout_points
      },
      rewards: {
        catalogTotal: rewards.catalog_total,
        activeCatalog: rewards.active_catalog,
        redemptionsTotal: redemptions.total,
        fulfilledRedemptions: redemptions.fulfilled,
        redeemedPointsTotal: redemptions.total_points_spent
      },
      ads: {
        eventsTotal: ads.total,
        validatedEvents: ads.validated,
        pointsGrantedTotal: ads.points_granted_total
      },
      points: {
        ledgerEntries: ledger.entries_total,
        netDelta: ledger.net_delta,
        creditsTotal: ledger.credits_total,
        debitsTotal: ledger.debits_total
      }
    };
  });

  fastify.get("/admin/markets", async (request) => {
    await requireAdmin(request);

    const query = request.query ?? {};
    const { status, sport } = query;
    const safeLimit = getSafeLimit(query.limit, 50);
    const safeOffset = getSafeOffset(query.offset, 0);

    const allowedStatuses = new Set(["DRAFT", "OPEN", "LOCKED", "SETTLED", "CANCELED"]);
    if (status && !allowedStatuses.has(status)) {
      throw new AppError("Invalid status filter", 400, "INVALID_STATUS");
    }

    const whereClauses = [];
    const whereValues = [];

    if (status) {
      whereValues.push(status);
      whereClauses.push(`m.status = $${whereValues.length}`);
    }

    if (sport) {
      whereValues.push(sport);
      whereClauses.push(`LOWER(m.sport) = LOWER($${whereValues.length})`);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";
    const limitParam = `$${whereValues.length + 1}`;
    const offsetParam = `$${whereValues.length + 2}`;

    const [itemsResult, totalResult] = await Promise.all([
      fastify.pg.query(
        `SELECT
           m.id,
           m.title,
           m.sport,
           m.event_ref,
           m.open_at,
           m.close_at,
           m.settle_at,
           m.status,
           m.created_at,
           m.updated_at,
           COALESCE(opt.options_count, 0)::int AS options_count,
           COALESCE(bt.bets_count, 0)::int AS bets_count
         FROM markets m
         LEFT JOIN (
           SELECT market_id, COUNT(*)::int AS options_count
           FROM market_options
           GROUP BY market_id
         ) opt ON opt.market_id = m.id
         LEFT JOIN (
           SELECT market_id, COUNT(*)::int AS bets_count
           FROM bets
           GROUP BY market_id
         ) bt ON bt.market_id = m.id
         ${whereSql}
         ORDER BY m.open_at DESC, m.created_at DESC
         LIMIT ${limitParam}
         OFFSET ${offsetParam}`,
        [...whereValues, safeLimit, safeOffset]
      ),
      fastify.pg.query(
        `SELECT COUNT(*)::int AS total
         FROM markets m
         ${whereSql}`,
        whereValues
      )
    ]);

    return {
      limit: safeLimit,
      offset: safeOffset,
      total: totalResult.rows[0].total,
      items: itemsResult.rows.map((row) => ({
        id: row.id,
        title: row.title,
        sport: row.sport,
        eventRef: row.event_ref,
        openAt: row.open_at,
        closeAt: row.close_at,
        settleAt: row.settle_at,
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        optionsCount: row.options_count,
        betsCount: row.bets_count
      }))
    };
  });

  fastify.post("/admin/markets", async (request, reply) => {
    const admin = await requireAdmin(request);
    const { title, sport, eventRef = null, openAt, closeAt, options = [] } = request.body ?? {};

    if (!title || !sport || !openAt || !closeAt || !Array.isArray(options) || options.length < 2) {
      throw new AppError("Invalid market payload", 400, "INVALID_PAYLOAD");
    }

    const created = await withTransaction(async (client) => {
      const marketInsert = await client.query(
        `INSERT INTO markets
          (title, sport, event_ref, open_at, close_at, status, created_by)
         VALUES
          ($1, $2, $3, $4, $5, 'DRAFT', $6)
         RETURNING id, title, sport, event_ref, open_at, close_at, status`,
        [title, sport, eventRef, openAt, closeAt, admin.id]
      );

      for (const option of options) {
        if (!option.label || Number(option.oddsDecimal) < 1) {
          throw new AppError("Invalid option payload", 400, "INVALID_OPTION");
        }

        await client.query(
          `INSERT INTO market_options
            (market_id, label, odds_decimal)
           VALUES
            ($1, $2, $3)`,
          [marketInsert.rows[0].id, option.label, Number(option.oddsDecimal)]
        );
      }

      return marketInsert.rows[0];
    });

    reply.code(201);
    return {
      id: created.id,
      title: created.title,
      sport: created.sport,
      eventRef: created.event_ref,
      openAt: created.open_at,
      closeAt: created.close_at,
      status: created.status
    };
  });

  fastify.patch("/admin/markets/:marketId/status", async (request) => {
    await requireAdmin(request);
    const { marketId } = request.params;
    const { status } = request.body ?? {};

    const allowed = new Set(["OPEN", "LOCKED", "CANCELED"]);
    if (!allowed.has(status)) {
      throw new AppError("Invalid status", 400, "INVALID_STATUS");
    }

    const result = await fastify.pg.query(
      `UPDATE markets
       SET status = $2, updated_at = now()
       WHERE id = $1
       RETURNING id, status`,
      [marketId, status]
    );

    if (result.rowCount === 0) {
      throw new AppError("Market not found", 404, "MARKET_NOT_FOUND");
    }

    return {
      marketId: result.rows[0].id,
      status: result.rows[0].status
    };
  });

  fastify.post("/admin/markets/:marketId/settle", async (request) => {
    const admin = await requireAdmin(request);
    const { marketId } = request.params;
    const { winnerOptionId, proofUrl = null, note = null } = request.body ?? {};

    if (!winnerOptionId) {
      throw new AppError("winnerOptionId is required", 400, "INVALID_PAYLOAD");
    }

    return settleMarket({
      marketId,
      winnerOptionId,
      proofUrl,
      note,
      actorId: admin.id
    });
  });

  fastify.post("/admin/rewards", async (request, reply) => {
    await requireAdmin(request);
    const {
      partnerName,
      title,
      description = null,
      pointsCost,
      stock = 0,
      isActive = true
    } = request.body ?? {};

    if (!partnerName || !title || !Number.isInteger(pointsCost) || pointsCost <= 0) {
      throw new AppError("Invalid reward payload", 400, "INVALID_PAYLOAD");
    }
    if (!Number.isInteger(stock) || stock < 0) {
      throw new AppError("Invalid stock", 400, "INVALID_PAYLOAD");
    }

    const insert = await fastify.pg.query(
      `INSERT INTO partner_rewards
        (partner_name, title, description, points_cost, stock, is_active)
       VALUES
        ($1, $2, $3, $4, $5, $6)
       RETURNING id, partner_name, title, description, points_cost, stock, is_active`,
      [partnerName, title, description, pointsCost, stock, Boolean(isActive)]
    );

    reply.code(201);
    return {
      id: insert.rows[0].id,
      partnerName: insert.rows[0].partner_name,
      title: insert.rows[0].title,
      description: insert.rows[0].description,
      pointsCost: insert.rows[0].points_cost,
      stock: insert.rows[0].stock,
      isActive: insert.rows[0].is_active
    };
  });
}
