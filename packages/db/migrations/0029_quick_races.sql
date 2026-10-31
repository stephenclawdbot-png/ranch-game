CREATE TABLE "match_race_runners" (
	"quick_race_id" uuid NOT NULL,
	"horse_id" uuid NOT NULL,
	"stable_id" uuid,
	"challenger" boolean DEFAULT false NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "match_race_runners_quick_race_id_horse_id_pk" PRIMARY KEY("quick_race_id","horse_id")
);
--> statement-breakpoint
CREATE TABLE "quick_races" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mode" text NOT NULL,
	"account_id" uuid NOT NULL,
	"stable_id" uuid NOT NULL,
	"horse_id" uuid,
	"source_race_id" uuid,
	"challenge_day" date,
	"engine_version" text NOT NULL,
	"input" jsonb NOT NULL,
	"summary" jsonb NOT NULL,
	"position" integer NOT NULL,
	"finish_time_us" bigint NOT NULL,
	"points" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "match_race_runners" ADD CONSTRAINT "match_race_runners_quick_race_id_quick_races_id_fk" FOREIGN KEY ("quick_race_id") REFERENCES "public"."quick_races"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_race_runners" ADD CONSTRAINT "match_race_runners_horse_id_horses_id_fk" FOREIGN KEY ("horse_id") REFERENCES "public"."horses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_race_runners" ADD CONSTRAINT "match_race_runners_stable_id_stables_id_fk" FOREIGN KEY ("stable_id") REFERENCES "public"."stables"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quick_races" ADD CONSTRAINT "quick_races_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quick_races" ADD CONSTRAINT "quick_races_stable_id_stables_id_fk" FOREIGN KEY ("stable_id") REFERENCES "public"."stables"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quick_races" ADD CONSTRAINT "quick_races_horse_id_horses_id_fk" FOREIGN KEY ("horse_id") REFERENCES "public"."horses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quick_races" ADD CONSTRAINT "quick_races_source_race_id_races_id_fk" FOREIGN KEY ("source_race_id") REFERENCES "public"."races"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "match_race_runners_horse_idx" ON "match_race_runners" USING btree ("horse_id","created_at");--> statement-breakpoint
CREATE INDEX "quick_races_stable_idx" ON "quick_races" USING btree ("stable_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "quick_races_daily_uq" ON "quick_races" USING btree ("stable_id","challenge_day");--> statement-breakpoint
CREATE INDEX "quick_races_daily_board_idx" ON "quick_races" USING btree ("challenge_day","position","finish_time_us");