-- Admin accounts: can't be hurt, can fly, have everything unlocked, and earn
-- no XP or leaderboard times. Set only from the server's command line
-- (server/src/tools/make-admin.ts), never through the API.
ALTER TABLE accounts ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT false;
