-- Phase 8: what each player has chosen to use and wear (spell, hat, robe).
-- Stored as JSON and checked against their unlocks every time it's read, so
-- a stale or hand-edited value can't equip something locked.
ALTER TABLE accounts ADD COLUMN loadout JSONB NOT NULL DEFAULT '{}'::jsonb;
