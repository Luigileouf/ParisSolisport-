-- Add real auth fields for JWT login.
-- Uses pgcrypto crypt() for password verification.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'player';

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS password_hash TEXT NOT NULL DEFAULT '';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ck_users_role'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT ck_users_role
      CHECK (role IN ('player', 'admin'));
  END IF;
END;
$$;

-- Seed known auth accounts for local/dev login.
UPDATE users
SET role = 'player',
    password_hash = crypt('PlayerDemo123!', gen_salt('bf'))
WHERE email = 'player@example.com';

UPDATE users
SET role = 'admin',
    password_hash = crypt('AdminDemo123!', gen_salt('bf'))
WHERE email = 'admin@example.com';
