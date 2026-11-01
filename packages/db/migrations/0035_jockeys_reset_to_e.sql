-- Every active jockey back to grade E (owner, 2026-11-01: "everyone starts at E" and jockeys grew too fast).
-- Jockeys made before the grade-E start, or grown under the old growth speed, kept grades A-D. Each skill
-- drops into the starting range (120..280, game-core JOCKEY_START_SKILL_MAX), to its own fixed value per
-- jockey and skill; a skill already lower stays as it is. Potential, rides, wins, experience and history
-- are untouched, so a talented jockey can climb again at the new pace. Retired jockeys keep their record.
UPDATE "jockeys"
SET "skills" = jsonb_build_object(
  'gate', LEAST(("skills"->>'gate')::int, 120 + mod(abs(hashtext("id"::text || ':gate')), 161)),
  'pace', LEAST(("skills"->>'pace')::int, 120 + mod(abs(hashtext("id"::text || ':pace')), 161)),
  'finish', LEAST(("skills"->>'finish')::int, 120 + mod(abs(hashtext("id"::text || ':finish')), 161)),
  'handling', LEAST(("skills"->>'handling')::int, 120 + mod(abs(hashtext("id"::text || ':handling')), 161))
)
WHERE "retired_at" IS NULL;
