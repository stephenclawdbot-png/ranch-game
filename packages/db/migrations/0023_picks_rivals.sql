CREATE TABLE "declared_rivals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inviter_stable_id" uuid NOT NULL,
	"invitee_stable_id" uuid NOT NULL,
	"source" text DEFAULT 'invite' NOT NULL,
	"welcome" text NOT NULL,
	"welcome_credits" integer DEFAULT 0 NOT NULL,
	"refused_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "declared_rivals_pair" CHECK ("declared_rivals"."inviter_stable_id" <> "declared_rivals"."invitee_stable_id"),
	CONSTRAINT "declared_rivals_welcome" CHECK ("declared_rivals"."welcome" in ('granted','refused'))
);
--> statement-breakpoint
CREATE TABLE "race_picks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"race_id" uuid NOT NULL,
	"stable_id" uuid NOT NULL,
	"horse_id" uuid NOT NULL,
	"post_time" timestamp with time zone NOT NULL,
	"outcome" text DEFAULT 'open' NOT NULL,
	"points" integer DEFAULT 0 NOT NULL,
	"rank" integer,
	"field_size" integer,
	"scored_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "race_picks_outcome" CHECK ("race_picks"."outcome" in ('open','won','lost','void'))
);
--> statement-breakpoint
ALTER TABLE "declared_rivals" ADD CONSTRAINT "declared_rivals_inviter_stable_id_stables_id_fk" FOREIGN KEY ("inviter_stable_id") REFERENCES "public"."stables"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "declared_rivals" ADD CONSTRAINT "declared_rivals_invitee_stable_id_stables_id_fk" FOREIGN KEY ("invitee_stable_id") REFERENCES "public"."stables"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "race_picks" ADD CONSTRAINT "race_picks_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "race_picks" ADD CONSTRAINT "race_picks_stable_id_stables_id_fk" FOREIGN KEY ("stable_id") REFERENCES "public"."stables"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "race_picks" ADD CONSTRAINT "race_picks_horse_id_horses_id_fk" FOREIGN KEY ("horse_id") REFERENCES "public"."horses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "declared_rivals_invitee_uq" ON "declared_rivals" USING btree ("invitee_stable_id");--> statement-breakpoint
CREATE INDEX "declared_rivals_inviter_idx" ON "declared_rivals" USING btree ("inviter_stable_id");--> statement-breakpoint
CREATE UNIQUE INDEX "race_picks_race_stable_uq" ON "race_picks" USING btree ("race_id","stable_id");--> statement-breakpoint
CREATE INDEX "race_picks_stable_idx" ON "race_picks" USING btree ("stable_id","post_time");--> statement-breakpoint
CREATE INDEX "race_picks_week_idx" ON "race_picks" USING btree ("post_time");--> statement-breakpoint
CREATE INDEX "race_picks_open_idx" ON "race_picks" USING btree ("post_time") WHERE "race_picks"."outcome" = 'open';--> statement-breakpoint
CREATE INDEX "accounts_created_idx" ON "accounts" USING btree ("created_at");