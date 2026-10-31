CREATE TABLE "what_if_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"race_id" uuid NOT NULL,
	"horse_id" uuid NOT NULL,
	"change_key" text NOT NULL,
	"engine_version" text NOT NULL,
	"resolved" jsonb NOT NULL,
	"summary" jsonb NOT NULL,
	"stable_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "what_if_runs" ADD CONSTRAINT "what_if_runs_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "what_if_runs" ADD CONSTRAINT "what_if_runs_horse_id_horses_id_fk" FOREIGN KEY ("horse_id") REFERENCES "public"."horses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "what_if_runs" ADD CONSTRAINT "what_if_runs_stable_id_stables_id_fk" FOREIGN KEY ("stable_id") REFERENCES "public"."stables"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "what_if_runs_uq" ON "what_if_runs" USING btree ("race_id","horse_id","change_key");