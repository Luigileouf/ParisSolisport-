import { pool } from "../db.js";

export default async function marketRoutes(fastify) {
  fastify.get("/markets", async (request) => {
    const status = request.query.status;
    const values = [];
    let where = "";
    if (status) {
      values.push(status);
      where = `WHERE m.status = $${values.length}`;
    }

    const markets = await pool.query(
      `SELECT m.id, m.title, m.sport, m.event_ref, m.open_at, m.close_at, m.status
       FROM markets m
       ${where}
       ORDER BY m.close_at ASC
       LIMIT 100`,
      values
    );

    const items = [];
    for (const market of markets.rows) {
      const options = await pool.query(
        `SELECT id, label, odds_decimal, is_winner
         FROM market_options
         WHERE market_id = $1
         ORDER BY label ASC`,
        [market.id]
      );

      items.push({
        id: market.id,
        title: market.title,
        sport: market.sport,
        eventRef: market.event_ref,
        openAt: market.open_at,
        closeAt: market.close_at,
        status: market.status,
        options: options.rows.map((option) => ({
          id: option.id,
          label: option.label,
          oddsDecimal: Number(option.odds_decimal),
          isWinner: option.is_winner
        }))
      });
    }

    return { items };
  });

  fastify.get("/markets/:marketId", async (request, reply) => {
    const { marketId } = request.params;
    const market = await pool.query(
      `SELECT id, title, sport, event_ref, open_at, close_at, settle_at, status
       FROM markets
       WHERE id = $1`,
      [marketId]
    );

    if (market.rowCount === 0) {
      reply.code(404);
      return { error: { code: "MARKET_NOT_FOUND", message: "Market not found" } };
    }

    const options = await pool.query(
      `SELECT id, label, odds_decimal, is_winner
       FROM market_options
       WHERE market_id = $1
       ORDER BY label ASC`,
      [marketId]
    );

    return {
      id: market.rows[0].id,
      title: market.rows[0].title,
      sport: market.rows[0].sport,
      eventRef: market.rows[0].event_ref,
      openAt: market.rows[0].open_at,
      closeAt: market.rows[0].close_at,
      settleAt: market.rows[0].settle_at,
      status: market.rows[0].status,
      options: options.rows.map((option) => ({
        id: option.id,
        label: option.label,
        oddsDecimal: Number(option.odds_decimal),
        isWinner: option.is_winner
      }))
    };
  });
}
