-- Accounts, XP and parkour best times.
-- Migrations run in filename order at server start (see server/src/db.ts);
-- never edit one that has already run in production, add a new file instead.

CREATE TABLE accounts (
  id              SERIAL PRIMARY KEY,
  username        TEXT NOT NULL,                 -- as typed, for display
  username_lower  TEXT NOT NULL UNIQUE,          -- for case-insensitive lookups
  password_hash   TEXT NOT NULL,                 -- argon2id, includes its own salt
  session_version INTEGER NOT NULL DEFAULT 1,    -- bump to log out all sessions
  xp              INTEGER NOT NULL DEFAULT 0 CHECK (xp >= 0),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at   TIMESTAMPTZ
);

-- Every XP award, so totals can be audited or rebuilt.
CREATE TABLE xp_events (
  id          BIGSERIAL PRIMARY KEY,
  account_id  INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  amount      INTEGER NOT NULL CHECK (amount > 0),
  reason      TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX xp_events_account ON xp_events (account_id, created_at);

-- One row per account per course: best time and how often it was finished.
CREATE TABLE best_times (
  account_id   INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  course_id    TEXT NOT NULL,
  time_ms      INTEGER NOT NULL CHECK (time_ms > 0),
  completions  INTEGER NOT NULL DEFAULT 1,
  achieved_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, course_id)
);
CREATE INDEX best_times_leaderboard ON best_times (course_id, time_ms);
