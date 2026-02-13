import { withTransaction } from "../db.js";
import { requireAdmin } from "../utils/auth.js";
import { AppError } from "../utils/errors.js";
import { settleMarket } from "../services/bets-service.js";

export default async function adminRoutes(fastify) {
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
