ALTER TABLE "jockeys" ADD COLUMN "look" jsonb;--> statement-breakpoint
ALTER TABLE "jockeys" ADD COLUMN "gender" text;--> statement-breakpoint
ALTER TABLE "jockeys" ADD CONSTRAINT "jockeys_gender" CHECK ("jockeys"."gender" is null or "jockeys"."gender" in ('f', 'm'));