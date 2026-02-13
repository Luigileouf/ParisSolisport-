import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import { buildApp } from "../../src/app.js";
import { pool } from "../../src/db.js";

const IDS = {
  player: "eeeeeeee-1111-1111-1111-111111111111",
  admin: "eeeeeeee-2222-2222-2222-222222222222",
  market: "eeeeeeee-3333-3333-3333-333333333333",
  optionRed: "eeeeeeee-4444-4444-4444-444444444441",
  optionBlue: "eeeeeeee-4444-4444-4444-444444444442",
  reward: "eeeeeeee-5555-5555-5555-555555555555"
};

let app;

async function resetData() {
  await pool.query(
    `TRUNCATE TABLE
       admin_audit_log,
       ad_reward_events,
       reward_redemptions,
       point_ledger,
       bets,
       market_options,
       markets,
       partner_rewards,
       users
     RESTART IDENTITY CASCADE`
  );
}

async function seedJourneyData() {
  await pool.query(
    `INSERT INTO users
      (id, email, display_name, role, password_hash, points_balance)
     VALUES
      ($1, 'journey.player@example.com', 'journey_player', 'player', crypt('JourneyPlayer123!', gen_salt('bf')), 100),
      ($2, 'journey.admin@example.com', 'journey_admin', 'admin', crypt('JourneyAdmin123!', gen_salt('bf')), 1000)`,
    [IDS.player, IDS.admin]
  );

  await pool.query(
    `INSERT INTO point_ledger
      (user_id, entry_type, points_delta, balance_after, ref_type, idempotency_key, meta)
     VALUES
      ($1, 'signup_bonus', 100, 100, 'signup', 'journey-seed-player', '{}'::jsonb),
      ($2, 'manual_adjustment', 1000, 1000, 'seed', 'journey-seed-admin', '{}'::jsonb)`,
    [IDS.player, IDS.admin]
  );

  await pool.query(
    `INSERT INTO markets
      (id, title, sport, event_ref, open_at, close_at, status, created_by)
     VALUES
      ($1, 'E2E - Couleur du short du capitaine', 'football', 'MATCH-E2E-001',
       now() - interval '1 hour', now() + interval '3 hours', 'OPEN', $2)`,
    [IDS.market, IDS.admin]
  );

  await pool.query(
    `INSERT INTO market_options
      (id, market_id, label, odds_decimal, is_winner)
     VALUES
      ($1, $3, 'Rouge', 2.00, false),
      ($2, $3, 'Bleu', 2.20, false)`,
    [IDS.optionRed, IDS.optionBlue, IDS.market]
  );

  await pool.query(
    `INSERT INTO partner_rewards
      (id, partner_name, title, description, points_cost, stock, is_active)
     VALUES
      ($1, 'Journey Partner', 'Reduction 10%', 'Coupon e2e', 80, 25, true)`,
    [IDS.reward]
  );
}

async function login(email, password) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: {
      email,
      password
    }
  });

  assert.equal(response.statusCode, 200);
  return response.json().accessToken;
}

before(async () => {
  app = buildApp();
  await app.ready();
});

beforeEach(async () => {
  const hasAuthColumns = await pool.query(
    `SELECT COUNT(*)::int AS c
     FROM information_schema.columns
     WHERE table_name = 'users'
       AND column_name IN ('role', 'password_hash')`
  );

  if (hasAuthColumns.rows[0].c < 2) {
    throw new Error(
      "Auth migration missing. Run `npm run migrate` before `npm run test:e2e`."
    );
  }

  await resetData();
  await seedJourneyData();
});

after(async () => {
  if (app) {
    await app.close();
  }
  await pool.end();
});

test("player journey: login -> place bet -> admin settle -> redeem reward", async () => {
  const playerToken = await login("journey.player@example.com", "JourneyPlayer123!");
  const adminToken = await login("journey.admin@example.com", "JourneyAdmin123!");

  const markets = await app.inject({
    method: "GET",
    url: "/api/v1/markets",
    headers: {
      authorization: `Bearer ${playerToken}`
    }
  });
  assert.equal(markets.statusCode, 200);
  assert.ok(Array.isArray(markets.json().items));
  assert.ok(markets.json().items.length >= 1);

  const placeBet = await app.inject({
    method: "POST",
    url: "/api/v1/bets",
    headers: {
      authorization: `Bearer ${playerToken}`,
      "idempotency-key": "e2e-bet-1"
    },
    payload: {
      marketId: IDS.market,
      optionId: IDS.optionRed,
      stakePoints: 20
    }
  });
  assert.equal(placeBet.statusCode, 201);
  assert.equal(placeBet.json().pointsBalance, 80);

  const settle = await app.inject({
    method: "POST",
    url: `/api/v1/admin/markets/${IDS.market}/settle`,
    headers: {
      authorization: `Bearer ${adminToken}`
    },
    payload: {
      winnerOptionId: IDS.optionRed,
      proofUrl: "https://example.test/e2e-proof"
    }
  });
  assert.equal(settle.statusCode, 200);

  const meAfterWin = await app.inject({
    method: "GET",
    url: "/api/v1/me",
    headers: {
      authorization: `Bearer ${playerToken}`
    }
  });
  assert.equal(meAfterWin.statusCode, 200);
  assert.equal(meAfterWin.json().pointsBalance, 120);

  const redeem = await app.inject({
    method: "POST",
    url: `/api/v1/rewards/${IDS.reward}/redeem`,
    headers: {
      authorization: `Bearer ${playerToken}`,
      "idempotency-key": "e2e-redeem-1"
    },
    payload: {}
  });
  assert.equal(redeem.statusCode, 201);
  assert.equal(redeem.json().pointsBalance, 40);
});
