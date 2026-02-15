import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, beforeEach, test } from "node:test";

import { buildApp } from "../../src/app.js";
import { pool } from "../../src/db.js";

const IDS = {
  playerA: "11111111-1111-1111-1111-111111111111",
  playerB: "12121212-1212-1212-1212-121212121212",
  admin: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  market: "22222222-2222-2222-2222-222222222222",
  optionRed: "44444444-4444-4444-4444-444444444441",
  optionBlue: "44444444-4444-4444-4444-444444444442",
  optionBlack: "44444444-4444-4444-4444-444444444443",
  reward: "33333333-3333-3333-3333-333333333333"
};

let app;
let authTokens;

function playerHeaders(userId = IDS.playerA) {
  return {
    authorization: `Bearer ${authTokens[userId]}`
  };
}

function adminHeaders() {
  return {
    authorization: `Bearer ${authTokens[IDS.admin]}`
  };
}

async function ensureSchema() {
  const result = await pool.query(
    "SELECT to_regclass('public.users') AS users_table"
  );

  if (result.rows[0].users_table) {
    return;
  }

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const migrationPath = path.resolve(__dirname, "../../migrations/001_init.sql");
  const sql = await fs.readFile(migrationPath, "utf8");
  await pool.query(sql);
}

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

async function seedData() {
  await pool.query(
    `INSERT INTO users (id, email, display_name, points_balance)
     VALUES
      ($1, 'player.a@example.com', 'player_a', 100),
      ($2, 'player.b@example.com', 'player_b', 100),
      ($3, 'admin@example.com', 'admin_demo', 1000)`,
    [IDS.playerA, IDS.playerB, IDS.admin]
  );

  await pool.query(
    `INSERT INTO point_ledger
      (user_id, entry_type, points_delta, balance_after, ref_type, idempotency_key, meta)
     VALUES
      ($1, 'signup_bonus', 100, 100, 'signup', 'seed-signup-player-a', '{}'::jsonb),
      ($2, 'signup_bonus', 100, 100, 'signup', 'seed-signup-player-b', '{}'::jsonb),
      ($3, 'manual_adjustment', 1000, 1000, 'seed', 'seed-admin-balance', '{}'::jsonb)`,
    [IDS.playerA, IDS.playerB, IDS.admin]
  );

  await pool.query(
    `INSERT INTO markets
      (id, title, sport, event_ref, open_at, close_at, status, created_by)
     VALUES
      ($1, 'Quelle sera la couleur du short du capitaine ?', 'football', 'MATCH-DEMO-001',
       now() - interval '1 hour', now() + interval '3 hours', 'OPEN', $2)`,
    [IDS.market, IDS.admin]
  );

  await pool.query(
    `INSERT INTO market_options
      (id, market_id, label, odds_decimal, is_winner)
     VALUES
      ($1, $4, 'Rouge', 2.00, false),
      ($2, $4, 'Bleu', 2.50, false),
      ($3, $4, 'Noir', 3.00, false)`,
    [IDS.optionRed, IDS.optionBlue, IDS.optionBlack, IDS.market]
  );

  await pool.query(
    `INSERT INTO partner_rewards
      (id, partner_name, title, description, points_cost, stock, is_active)
     VALUES
      ($1, 'Partenaire Demo', 'Reduction 10%', 'Coupon digital', 80, 5, true)`,
    [IDS.reward]
  );
}

async function getBalance(userId) {
  const result = await pool.query(
    "SELECT points_balance FROM users WHERE id = $1",
    [userId]
  );
  return result.rows[0].points_balance;
}

async function countRows(table, where = "", values = []) {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS c FROM ${table} ${where}`,
    values
  );
  return result.rows[0].c;
}

before(async () => {
  await ensureSchema();
  app = buildApp();
  await app.ready();
  authTokens = {
    [IDS.playerA]: app.jwt.sign(
      { role: "player", email: "player.a@example.com" },
      { sub: IDS.playerA }
    ),
    [IDS.playerB]: app.jwt.sign(
      { role: "player", email: "player.b@example.com" },
      { sub: IDS.playerB }
    ),
    [IDS.admin]: app.jwt.sign(
      { role: "admin", email: "admin@example.com" },
      { sub: IDS.admin }
    )
  };
});

beforeEach(async () => {
  await resetData();
  await seedData();
});

after(async () => {
  if (app) {
    await app.close();
  }
  await pool.end();
});

test("1) health endpoint returns 200", async () => {
  const response = await app.inject({
    method: "GET",
    url: "/api/v1/health"
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().ok, true);
});

test("2) place bet debits points and creates bet", async () => {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/bets",
    headers: {
      ...playerHeaders(),
      "idempotency-key": "bet-test-1"
    },
    payload: {
      marketId: IDS.market,
      optionId: IDS.optionRed,
      stakePoints: 20
    }
  });

  assert.equal(response.statusCode, 201);
  const body = response.json();
  assert.equal(body.status, "PLACED");
  assert.equal(body.pointsBalance, 80);

  assert.equal(await getBalance(IDS.playerA), 80);
  assert.equal(await countRows("bets"), 1);
  assert.equal(
    await countRows("point_ledger", "WHERE entry_type = 'bet_stake'"),
    1
  );
});

test("3) same Idempotency-Key does not double debit points", async () => {
  const request = {
    method: "POST",
    url: "/api/v1/bets",
    headers: {
      ...playerHeaders(),
      "idempotency-key": "bet-idem-1"
    },
    payload: {
      marketId: IDS.market,
      optionId: IDS.optionBlue,
      stakePoints: 20
    }
  };

  const first = await app.inject(request);
  const second = await app.inject(request);

  assert.equal(first.statusCode, 201);
  assert.equal(second.statusCode, 200);
  assert.equal(await getBalance(IDS.playerA), 80);
  assert.equal(await countRows("bets"), 1);
  assert.equal(
    await countRows("point_ledger", "WHERE entry_type = 'bet_stake'"),
    1
  );
});

test("4) insufficient points returns 422 and no extra bet", async () => {
  for (let i = 0; i < 2; i += 1) {
    const ok = await app.inject({
      method: "POST",
      url: "/api/v1/bets",
      headers: {
        ...playerHeaders(),
        "idempotency-key": `bet-spend-${i}`
      },
      payload: {
        marketId: IDS.market,
        optionId: IDS.optionRed,
        stakePoints: 50
      }
    });
    assert.equal(ok.statusCode, 201);
  }

  const fail = await app.inject({
    method: "POST",
    url: "/api/v1/bets",
    headers: {
      ...playerHeaders(),
      "idempotency-key": "bet-spend-overflow"
    },
    payload: {
      marketId: IDS.market,
      optionId: IDS.optionRed,
      stakePoints: 50
    }
  });

  assert.equal(fail.statusCode, 422);
  assert.equal(fail.json().error.code, "INSUFFICIENT_POINTS");
  assert.equal(await getBalance(IDS.playerA), 0);
  assert.equal(await countRows("bets"), 2);
});

test("5) settle market credits winners and not losers", async () => {
  const betWinner = await app.inject({
    method: "POST",
    url: "/api/v1/bets",
    headers: {
      ...playerHeaders(IDS.playerA),
      "idempotency-key": "bet-winner"
    },
    payload: {
      marketId: IDS.market,
      optionId: IDS.optionRed,
      stakePoints: 20
    }
  });
  assert.equal(betWinner.statusCode, 201);

  const betLoser = await app.inject({
    method: "POST",
    url: "/api/v1/bets",
    headers: {
      ...playerHeaders(IDS.playerB),
      "idempotency-key": "bet-loser"
    },
    payload: {
      marketId: IDS.market,
      optionId: IDS.optionBlue,
      stakePoints: 20
    }
  });
  assert.equal(betLoser.statusCode, 201);

  const settle = await app.inject({
    method: "POST",
    url: `/api/v1/admin/markets/${IDS.market}/settle`,
    headers: adminHeaders(),
    payload: {
      winnerOptionId: IDS.optionRed,
      proofUrl: "https://example.test/proof",
      note: "integration test settlement"
    }
  });

  assert.equal(settle.statusCode, 200);
  const settleBody = settle.json();
  assert.equal(settleBody.winCount, 1);
  assert.equal(settleBody.lossCount, 1);

  assert.equal(await getBalance(IDS.playerA), 120);
  assert.equal(await getBalance(IDS.playerB), 80);

  const statuses = await pool.query(
    "SELECT status FROM bets ORDER BY status ASC"
  );
  const values = statuses.rows.map((row) => row.status).sort();
  assert.deepEqual(values, ["LOSS", "WIN"]);
});

test("6) reward redeem debits points and decrements stock", async () => {
  const redeem = await app.inject({
    method: "POST",
    url: `/api/v1/rewards/${IDS.reward}/redeem`,
    headers: {
      ...playerHeaders(),
      "idempotency-key": "reward-redeem-1"
    },
    payload: {}
  });

  assert.equal(redeem.statusCode, 201);
  const body = redeem.json();
  assert.equal(body.status, "FULFILLED");
  assert.equal(body.pointsSpent, 80);
  assert.equal(body.pointsBalance, 20);
  assert.match(body.code, /^REWARD-/);

  const stock = await pool.query(
    "SELECT stock FROM partner_rewards WHERE id = $1",
    [IDS.reward]
  );
  assert.equal(stock.rows[0].stock, 4);
});

test("7) reward redeem is idempotent with same key", async () => {
  const request = {
    method: "POST",
    url: `/api/v1/rewards/${IDS.reward}/redeem`,
    headers: {
      ...playerHeaders(),
      "idempotency-key": "reward-idem-1"
    },
    payload: {}
  };

  const first = await app.inject(request);
  const second = await app.inject(request);

  assert.equal(first.statusCode, 201);
  assert.equal(second.statusCode, 200);
  assert.equal(await getBalance(IDS.playerA), 20);
  assert.equal(await countRows("reward_redemptions"), 1);

  const stock = await pool.query(
    "SELECT stock FROM partner_rewards WHERE id = $1",
    [IDS.reward]
  );
  assert.equal(stock.rows[0].stock, 4);
});

test("8) ad reward callback credits once for same networkEventId", async () => {
  const first = await app.inject({
    method: "POST",
    url: "/api/v1/ads/reward-callback",
    payload: {
      network: "demo_network",
      networkEventId: "evt-1",
      userExternalId: IDS.playerA,
      watched: true,
      signature: "signed"
    }
  });
  assert.equal(first.statusCode, 200);
  assert.equal(first.json().alreadyProcessed, false);

  const second = await app.inject({
    method: "POST",
    url: "/api/v1/ads/reward-callback",
    payload: {
      network: "demo_network",
      networkEventId: "evt-1",
      userExternalId: IDS.playerA,
      watched: true,
      signature: "signed"
    }
  });

  assert.equal(second.statusCode, 200);
  assert.equal(second.json().alreadyProcessed, true);
  assert.equal(await getBalance(IDS.playerA), 120);
  assert.equal(
    await countRows("point_ledger", "WHERE entry_type = 'ad_reward'"),
    1
  );
});

test("9) ad reward daily cap blocks the 6th callback", async () => {
  for (let i = 1; i <= 5; i += 1) {
    const ok = await app.inject({
      method: "POST",
      url: "/api/v1/ads/reward-callback",
      payload: {
        network: "demo_network",
        networkEventId: `evt-cap-${i}`,
        userExternalId: IDS.playerA,
        watched: true,
        signature: "signed"
      }
    });
    assert.equal(ok.statusCode, 200);
  }

  const blocked = await app.inject({
    method: "POST",
    url: "/api/v1/ads/reward-callback",
    payload: {
      network: "demo_network",
      networkEventId: "evt-cap-6",
      userExternalId: IDS.playerA,
      watched: true,
      signature: "signed"
    }
  });

  assert.equal(blocked.statusCode, 429);
  assert.equal(blocked.json().error.code, "AD_DAILY_LIMIT_REACHED");
  assert.equal(await getBalance(IDS.playerA), 200);
});

test("10) admin routes reject non-admin user", async () => {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/admin/rewards",
    headers: playerHeaders(),
    payload: {
      partnerName: "X",
      title: "Gift",
      pointsCost: 60,
      stock: 10,
      isActive: true
    }
  });

  assert.equal(response.statusCode, 403);
  assert.equal(response.json().error.code, "FORBIDDEN");
});

test("11) me history returns bets, ledger and redemptions with safe limit", async () => {
  const bet = await app.inject({
    method: "POST",
    url: "/api/v1/bets",
    headers: {
      ...playerHeaders(),
      "idempotency-key": "history-bet-1"
    },
    payload: {
      marketId: IDS.market,
      optionId: IDS.optionRed,
      stakePoints: 20
    }
  });
  assert.equal(bet.statusCode, 201);

  const redeem = await app.inject({
    method: "POST",
    url: `/api/v1/rewards/${IDS.reward}/redeem`,
    headers: {
      ...playerHeaders(),
      "idempotency-key": "history-redeem-1"
    },
    payload: {}
  });
  assert.equal(redeem.statusCode, 201);

  const history = await app.inject({
    method: "GET",
    url: "/api/v1/me/history?limit=2",
    headers: playerHeaders()
  });

  assert.equal(history.statusCode, 200);
  const body = history.json();
  assert.equal(body.limit, 2);

  assert.equal(body.bets.length, 1);
  assert.equal(body.bets[0].status, "PLACED");
  assert.equal(body.bets[0].marketId, IDS.market);

  assert.equal(body.redemptions.length, 1);
  assert.equal(body.redemptions[0].rewardId, IDS.reward);
  assert.equal(body.redemptions[0].status, "FULFILLED");
  assert.equal(body.redemptions[0].partnerName, "Partenaire Demo");

  assert.equal(body.ledger.length, 2);
  const entryTypes = new Set(body.ledger.map((entry) => entry.entryType));
  assert.equal(entryTypes.has("bet_stake"), true);
  assert.equal(entryTypes.has("reward_redeem"), true);
});
