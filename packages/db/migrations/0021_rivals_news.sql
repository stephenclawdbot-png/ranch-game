CREATE TABLE "news_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dedupe_key" text NOT NULL,
	"kind" text NOT NULL,
	"headline" text NOT NULL,
	"href" text NOT NULL,
	"public_at" timestamp with time zone NOT NULL,
	"race_id" uuid,
	"horse_id" uuid,
	"jockey_id" uuid,
	"stable_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "race_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"horse_id" uuid NOT NULL,
	"stable_id" uuid NOT NULL,
	"slot_index" integer NOT NULL,
	"race_id" uuid,
	"name" text NOT NULL,
	"race_class" text NOT NULL,
	"post_time" timestamp with time zone NOT NULL,
	"reminded_open_at" timestamp with time zone,
	"reminded_close_at" timestamp with time zone,
	"removed_at" timestamp with time zone,
	"removed_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "news_items" ADD CONSTRAINT "news_items_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "news_items" ADD CONSTRAINT "news_items_horse_id_horses_id_fk" FOREIGN KEY ("horse_id") REFERENCES "public"."horses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "news_items" ADD CONSTRAINT "news_items_jockey_id_jockeys_id_fk" FOREIGN KEY ("jockey_id") REFERENCES "public"."jockeys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "race_targets" ADD CONSTRAINT "race_targets_horse_id_horses_id_fk" FOREIGN KEY ("horse_id") REFERENCES "public"."horses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "race_targets" ADD CONSTRAINT "race_targets_stable_id_stables_id_fk" FOREIGN KEY ("stable_id") REFERENCES "public"."stables"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "race_targets" ADD CONSTRAINT "race_targets_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "news_items_dedupe_uq" ON "news_items" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "news_items_public_idx" ON "news_items" USING btree ("public_at");--> statement-breakpoint
CREATE INDEX "news_items_stables_idx" ON "news_items" USING gin ("stable_ids");--> statement-breakpoint
CREATE UNIQUE INDEX "race_targets_active_uq" ON "race_targets" USING btree ("horse_id","slot_index") WHERE "race_targets"."removed_at" is null;--> statement-breakpoint
CREATE INDEX "race_targets_stable_idx" ON "race_targets" USING btree ("stable_id","post_time");--> statement-breakpoint
CREATE INDEX "race_targets_horse_idx" ON "race_targets" USING btree ("horse_id","post_time");--> statement-breakpoint
CREATE INDEX "race_targets_due_idx" ON "race_targets" USING btree ("post_time") WHERE "race_targets"."removed_at" is null;