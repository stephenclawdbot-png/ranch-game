-- Horse registry (additive; preview and production share one database).
--  * reg_no: a public registration sequence shown as G<generation>-<reg_no>. Existing horses
--    are numbered in creation order; new rows get nextval() from the column default, so code
--    that predates this column keeps working unchanged.
--  * lower(name) index: name-uniqueness checks (enforced in the services with an advisory
--    lock, not a unique index, so older code paths and grandfathered duplicates never fail).
CREATE SEQUENCE IF NOT EXISTS "public"."horse_reg_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
ALTER TABLE "horses" ADD COLUMN IF NOT EXISTS "reg_no" integer;--> statement-breakpoint
UPDATE "horses" h SET "reg_no" = s.n
  FROM (SELECT id, row_number() OVER (ORDER BY created_at, id) AS n FROM "horses") s
 WHERE h.id = s.id AND h."reg_no" IS NULL;--> statement-breakpoint
SELECT setval('horse_reg_seq', (SELECT coalesce(max("reg_no"), 0) + 1 FROM "horses"), false);--> statement-breakpoint
ALTER TABLE "horses" ALTER COLUMN "reg_no" SET DEFAULT nextval('horse_reg_seq');--> statement-breakpoint
ALTER TABLE "horses" ALTER COLUMN "reg_no" SET NOT NULL;--> statement-breakpoint
ALTER SEQUENCE "public"."horse_reg_seq" OWNED BY "horses"."reg_no";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "horses_reg_no_uq" ON "horses" USING btree ("reg_no");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "horses_name_lower_idx" ON "horses" USING btree (lower("name"));
