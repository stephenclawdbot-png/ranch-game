CREATE TABLE "jockey_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"jockey_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"stable_id" uuid,
	"at" timestamp with time zone NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "jockey_events_kind" CHECK ("jockey_events"."kind" in ('debut', 'signed', 'released', 'retirement_announced', 'retired'))
);
--> statement-breakpoint
CREATE TABLE "jockey_rides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"jockey_id" uuid NOT NULL,
	"race_id" uuid NOT NULL,
	"horse_id" uuid NOT NULL,
	"stable_id" uuid,
	"jockey_stable_id" uuid,
	"post_time" timestamp with time zone NOT NULL,
	"claim_lb" integer DEFAULT 0 NOT NULL,
	"fee" bigint DEFAULT 0 NOT NULL,
	"position" integer,
	"experience" integer,
	"settled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jockey_weeks" (
	"week" integer PRIMARY KEY NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ran_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jockeys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"seed" text NOT NULL,
	"born_at" timestamp with time zone NOT NULL,
	"stage" text DEFAULT 'apprentice' NOT NULL,
	"personality" text NOT NULL,
	"skills" jsonb NOT NULL,
	"potential" jsonb NOT NULL,
	"experience" integer DEFAULT 0 NOT NULL,
	"rides" integer DEFAULT 0 NOT NULL,
	"wins" integer DEFAULT 0 NOT NULL,
	"stable_id" uuid,
	"joined_at" timestamp with time zone,
	"last_stable_id" uuid,
	"released_at" timestamp with time zone,
	"retire_at" timestamp with time zone NOT NULL,
	"retirement_announced_at" timestamp with time zone,
	"retired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jockeys_stage" CHECK ("jockeys"."stage" in ('apprentice', 'prime', 'veteran')),
	CONSTRAINT "jockeys_personality" CHECK ("jockeys"."personality" in ('money', 'ambitious', 'loyal', 'workhorse')),
	CONSTRAINT "jockeys_counts" CHECK ("jockeys"."rides" >= 0 and "jockeys"."wins" between 0 and "jockeys"."rides" and "jockeys"."experience" >= 0)
);
--> statement-breakpoint
ALTER TABLE "race_entries" ADD COLUMN "jockey_id" uuid;--> statement-breakpoint
ALTER TABLE "jockey_events" ADD CONSTRAINT "jockey_events_jockey_id_jockeys_id_fk" FOREIGN KEY ("jockey_id") REFERENCES "public"."jockeys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jockey_events" ADD CONSTRAINT "jockey_events_stable_id_stables_id_fk" FOREIGN KEY ("stable_id") REFERENCES "public"."stables"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jockey_rides" ADD CONSTRAINT "jockey_rides_jockey_id_jockeys_id_fk" FOREIGN KEY ("jockey_id") REFERENCES "public"."jockeys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jockey_rides" ADD CONSTRAINT "jockey_rides_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jockey_rides" ADD CONSTRAINT "jockey_rides_horse_id_horses_id_fk" FOREIGN KEY ("horse_id") REFERENCES "public"."horses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jockey_rides" ADD CONSTRAINT "jockey_rides_stable_id_stables_id_fk" FOREIGN KEY ("stable_id") REFERENCES "public"."stables"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jockey_rides" ADD CONSTRAINT "jockey_rides_jockey_stable_id_stables_id_fk" FOREIGN KEY ("jockey_stable_id") REFERENCES "public"."stables"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jockeys" ADD CONSTRAINT "jockeys_stable_id_stables_id_fk" FOREIGN KEY ("stable_id") REFERENCES "public"."stables"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jockeys" ADD CONSTRAINT "jockeys_last_stable_id_stables_id_fk" FOREIGN KEY ("last_stable_id") REFERENCES "public"."stables"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "jockey_events_key_uq" ON "jockey_events" USING btree ("key");--> statement-breakpoint
CREATE INDEX "jockey_events_jockey_idx" ON "jockey_events" USING btree ("jockey_id","at");--> statement-breakpoint
CREATE INDEX "jockey_events_stable_idx" ON "jockey_events" USING btree ("stable_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "jockey_rides_race_jockey_uq" ON "jockey_rides" USING btree ("race_id","jockey_id");--> statement-breakpoint
CREATE UNIQUE INDEX "jockey_rides_race_horse_uq" ON "jockey_rides" USING btree ("race_id","horse_id");--> statement-breakpoint
CREATE INDEX "jockey_rides_jockey_idx" ON "jockey_rides" USING btree ("jockey_id","post_time");--> statement-breakpoint
CREATE INDEX "jockey_rides_post_idx" ON "jockey_rides" USING btree ("post_time");--> statement-breakpoint
CREATE INDEX "jockeys_stable_idx" ON "jockeys" USING btree ("stable_id","retired_at");--> statement-breakpoint
CREATE INDEX "jockeys_active_idx" ON "jockeys" USING btree ("retired_at","stable_id");--> statement-breakpoint
ALTER TABLE "race_entries" ADD CONSTRAINT "race_entries_jockey_id_jockeys_id_fk" FOREIGN KEY ("jockey_id") REFERENCES "public"."jockeys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "race_entries_jockey_idx" ON "race_entries" USING btree ("jockey_id");