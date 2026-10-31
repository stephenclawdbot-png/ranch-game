CREATE TABLE "jockey_contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"jockey_id" uuid NOT NULL,
	"stable_id" uuid NOT NULL,
	"length" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"start_week" integer NOT NULL,
	"ends_week" integer NOT NULL,
	"wage" bigint NOT NULL,
	"wage_free_until_week" integer,
	"promised_rides" integer NOT NULL,
	"buyout" bigint NOT NULL,
	"broken_weeks" integer DEFAULT 0 NOT NULL,
	"last_rides_week" integer,
	"last_week_rides" integer,
	"unpaid_week" integer,
	"wages_paid" bigint DEFAULT 0 NOT NULL,
	"notes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"ended_at" timestamp with time zone,
	"ended_why" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jockey_contracts_status" CHECK ("jockey_contracts"."status" in ('active', 'ended')),
	CONSTRAINT "jockey_contracts_terms" CHECK ("jockey_contracts"."wage" >= 0 and "jockey_contracts"."promised_rides" >= 0 and "jockey_contracts"."buyout" >= 0 and "jockey_contracts"."ends_week" > "jockey_contracts"."start_week")
);
--> statement-breakpoint
CREATE TABLE "jockey_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"week" integer NOT NULL,
	"jockey_id" uuid NOT NULL,
	"stable_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"length" text NOT NULL,
	"wage" bigint NOT NULL,
	"promised_rides" integer NOT NULL,
	"buyout" bigint NOT NULL,
	"fee" bigint DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"utility" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "jockey_offers_status" CHECK ("jockey_offers"."status" in ('open', 'won', 'lost', 'withdrawn'))
);
--> statement-breakpoint
ALTER TABLE "jockey_weeks" ADD COLUMN "window_seed" text;--> statement-breakpoint
ALTER TABLE "jockey_weeks" ADD COLUMN "window_commitment" text;--> statement-breakpoint
ALTER TABLE "jockey_weeks" ADD COLUMN "window_ran_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "jockey_weeks" ADD COLUMN "window" jsonb;--> statement-breakpoint
ALTER TABLE "jockeys" ADD COLUMN "free_agent_week" integer;--> statement-breakpoint
ALTER TABLE "jockeys" ADD COLUMN "developed_by_stable_id" uuid;--> statement-breakpoint
ALTER TABLE "jockey_contracts" ADD CONSTRAINT "jockey_contracts_jockey_id_jockeys_id_fk" FOREIGN KEY ("jockey_id") REFERENCES "public"."jockeys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jockey_contracts" ADD CONSTRAINT "jockey_contracts_stable_id_stables_id_fk" FOREIGN KEY ("stable_id") REFERENCES "public"."stables"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jockey_offers" ADD CONSTRAINT "jockey_offers_jockey_id_jockeys_id_fk" FOREIGN KEY ("jockey_id") REFERENCES "public"."jockeys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jockey_offers" ADD CONSTRAINT "jockey_offers_stable_id_stables_id_fk" FOREIGN KEY ("stable_id") REFERENCES "public"."stables"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jockey_offers" ADD CONSTRAINT "jockey_offers_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "jockey_contracts_active_uq" ON "jockey_contracts" USING btree ("jockey_id") WHERE "jockey_contracts"."status" = 'active';--> statement-breakpoint
CREATE INDEX "jockey_contracts_stable_idx" ON "jockey_contracts" USING btree ("stable_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "jockey_offers_week_uq" ON "jockey_offers" USING btree ("week","jockey_id","stable_id");--> statement-breakpoint
CREATE INDEX "jockey_offers_stable_idx" ON "jockey_offers" USING btree ("stable_id","status");--> statement-breakpoint
CREATE INDEX "jockey_offers_jockey_idx" ON "jockey_offers" USING btree ("jockey_id","week");--> statement-breakpoint
ALTER TABLE "jockeys" ADD CONSTRAINT "jockeys_developed_by_stable_id_stables_id_fk" FOREIGN KEY ("developed_by_stable_id") REFERENCES "public"."stables"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "jockeys_free_agent_idx" ON "jockeys" USING btree ("free_agent_week");