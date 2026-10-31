CREATE TABLE "horse_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"horse_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"stable_id" uuid,
	"race_id" uuid,
	"at" timestamp with time zone NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dedupe_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "horse_log" ADD CONSTRAINT "horse_log_horse_id_horses_id_fk" FOREIGN KEY ("horse_id") REFERENCES "public"."horses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "horse_log" ADD CONSTRAINT "horse_log_stable_id_stables_id_fk" FOREIGN KEY ("stable_id") REFERENCES "public"."stables"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "horse_log" ADD CONSTRAINT "horse_log_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "horse_log_horse_key_uq" ON "horse_log" USING btree ("horse_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "horse_log_horse_at_idx" ON "horse_log" USING btree ("horse_id","at");--> statement-breakpoint
CREATE INDEX "care_log_horse_created_idx" ON "care_log" USING btree ("horse_id","created_at");--> statement-breakpoint
CREATE INDEX "horse_leases_horse_idx" ON "horse_leases" USING btree ("horse_id","starts_at");