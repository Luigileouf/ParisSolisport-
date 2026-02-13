-- Development seed data for quick local testing.
-- This migration is optional in production.

INSERT INTO users (id, email, display_name, points_balance)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'player@example.com', 'player_demo', 100),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'admin@example.com', 'admin_demo', 1000);

INSERT INTO point_ledger
  (user_id, entry_type, points_delta, balance_after, ref_type, idempotency_key, meta)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'signup_bonus', 100, 100, 'signup', 'seed-signup-player', '{}'::jsonb),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'manual_adjustment', 1000, 1000, 'seed', 'seed-admin-balance', '{}'::jsonb);

INSERT INTO markets (id, title, sport, event_ref, open_at, close_at, status, created_by)
VALUES
  (
    '22222222-2222-2222-2222-222222222222',
    'Quelle sera la couleur du short du capitaine ?',
    'football',
    'MATCH-DEMO-001',
    now() - interval '1 hour',
    now() + interval '3 hours',
    'OPEN',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  );

INSERT INTO market_options (market_id, label, odds_decimal, is_winner)
VALUES
  ('22222222-2222-2222-2222-222222222222', 'Rouge', 2.00, false),
  ('22222222-2222-2222-2222-222222222222', 'Bleu', 2.50, false),
  ('22222222-2222-2222-2222-222222222222', 'Noir', 3.00, false);

INSERT INTO partner_rewards (id, partner_name, title, description, points_cost, stock, is_active)
VALUES
  (
    '33333333-3333-3333-3333-333333333333',
    'Partenaire Demo',
    'Reduction 10%',
    'Coupon digital utilisable en boutique partenaire.',
    80,
    500,
    true
  );
