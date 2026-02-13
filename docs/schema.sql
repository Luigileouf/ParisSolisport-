-- PostgreSQL schema (MVP) - points betting game
-- ASCII only. Use UTC timestamps.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE market_status AS ENUM ('DRAFT', 'OPEN', 'LOCKED', 'SETTLED', 'CANCELED');
CREATE TYPE bet_status AS ENUM ('PLACED', 'WIN', 'LOSS', 'VOID');
CREATE TYPE ledger_type AS ENUM (
  'signup_bonus',
  'bet_stake',
  'bet_payout',
  'bet_refund',
  'reward_redeem',
  'ad_reward',
  'manual_adjustment'
);
CREATE TYPE redemption_status AS ENUM ('REQUESTED', 'FULFILLED', 'REJECTED', 'CANCELED');

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'player' CHECK (role IN ('player', 'admin')),
  password_hash TEXT NOT NULL DEFAULT '',
  points_balance INTEGER NOT NULL DEFAULT 0 CHECK (points_balance >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE markets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  sport TEXT NOT NULL,
  event_ref TEXT,
  open_at TIMESTAMPTZ NOT NULL,
  close_at TIMESTAMPTZ NOT NULL,
  settle_at TIMESTAMPTZ,
  status market_status NOT NULL DEFAULT 'DRAFT',
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (close_at > open_at)
);

CREATE TABLE market_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id UUID NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  odds_decimal NUMERIC(8,2) NOT NULL CHECK (odds_decimal >= 1.00),
  is_winner BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ux_market_options_label ON market_options(market_id, label);

CREATE TABLE bets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  market_id UUID NOT NULL REFERENCES markets(id),
  option_id UUID NOT NULL REFERENCES market_options(id),
  stake_points INTEGER NOT NULL CHECK (stake_points > 0),
  odds_decimal NUMERIC(8,2) NOT NULL CHECK (odds_decimal >= 1.00),
  payout_points INTEGER NOT NULL DEFAULT 0 CHECK (payout_points >= 0),
  status bet_status NOT NULL DEFAULT 'PLACED',
  idempotency_key TEXT NOT NULL,
  placed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  settled_at TIMESTAMPTZ,
  UNIQUE (idempotency_key)
);

CREATE INDEX ix_bets_user_market ON bets(user_id, market_id);
CREATE INDEX ix_bets_market_status ON bets(market_id, status);

CREATE TABLE point_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  entry_type ledger_type NOT NULL,
  points_delta INTEGER NOT NULL,
  balance_after INTEGER NOT NULL CHECK (balance_after >= 0),
  ref_type TEXT NOT NULL,
  ref_id UUID,
  idempotency_key TEXT NOT NULL UNIQUE,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ix_point_ledger_user_time ON point_ledger(user_id, created_at DESC);

CREATE TABLE partner_rewards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_name TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  points_cost INTEGER NOT NULL CHECK (points_cost > 0),
  stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE reward_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  reward_id UUID NOT NULL REFERENCES partner_rewards(id),
  points_spent INTEGER NOT NULL CHECK (points_spent > 0),
  code TEXT UNIQUE,
  status redemption_status NOT NULL DEFAULT 'REQUESTED',
  idempotency_key TEXT NOT NULL UNIQUE,
  fulfilled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ad_reward_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  ad_network TEXT NOT NULL,
  network_event_id TEXT NOT NULL,
  points_granted INTEGER NOT NULL CHECK (points_granted > 0),
  validated BOOLEAN NOT NULL DEFAULT false,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (ad_network, network_event_id)
);

CREATE TABLE admin_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id UUID,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Optional helper: keep users.updated_at fresh
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_markets_updated_at
BEFORE UPDATE ON markets
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_rewards_updated_at
BEFORE UPDATE ON partner_rewards
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- NOTE:
-- Update users.points_balance and point_ledger in one DB transaction.
-- Never write direct balance changes without corresponding ledger entry.
