import { AppError } from "../utils/errors.js";

export async function applyPointDelta({
  client,
  userId,
  delta,
  entryType,
  refType,
  refId = null,
  idempotencyKey,
  meta = {}
}) {
  const existing = await client.query(
    `SELECT id, balance_after
     FROM point_ledger
     WHERE idempotency_key = $1`,
    [idempotencyKey]
  );

  if (existing.rowCount > 0) {
    return {
      ledgerId: existing.rows[0].id,
      balanceAfter: existing.rows[0].balance_after,
      alreadyApplied: true
    };
  }

  const userResult = await client.query(
    `SELECT points_balance
     FROM users
     WHERE id = $1
     FOR UPDATE`,
    [userId]
  );

  if (userResult.rowCount === 0) {
    throw new AppError("User not found", 404, "USER_NOT_FOUND");
  }

  const currentBalance = userResult.rows[0].points_balance;
  const nextBalance = currentBalance + delta;
  if (nextBalance < 0) {
    throw new AppError("Insufficient points", 422, "INSUFFICIENT_POINTS");
  }

  await client.query(
    `UPDATE users
     SET points_balance = $2, updated_at = now()
     WHERE id = $1`,
    [userId, nextBalance]
  );

  const ledgerInsert = await client.query(
    `INSERT INTO point_ledger
      (user_id, entry_type, points_delta, balance_after, ref_type, ref_id, idempotency_key, meta)
     VALUES
      ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
     RETURNING id`,
    [userId, entryType, delta, nextBalance, refType, refId, idempotencyKey, JSON.stringify(meta)]
  );

  return {
    ledgerId: ledgerInsert.rows[0].id,
    balanceAfter: nextBalance,
    alreadyApplied: false
  };
}
