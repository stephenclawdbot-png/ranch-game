CREATE TYPE "public"."tote_bet_status" AS ENUM('open', 'won', 'lost', 'returned', 'void');--> statement-breakpoint
CREATE TYPE "public"."tote_pool" AS ENUM('win', 'place');--> statement-breakpoint
ALTER TYPE "public"."ledger_account_kind" ADD VALUE 'tote_house';--> statement-breakpoint
CREATE TABLE "tote_bets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"race_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"stable_id" uuid,
	"horse_id" uuid NOT NULL,
	"pool" "tote_pool" NOT NULL,
	"currency" text NOT NULL,
	"stake" bigint NOT NULL,
	"status" "tote_bet_status" DEFAULT 'open' NOT NULL,
	"payout" bigint DEFAULT 0 NOT NULL,
	"void_reason" text,
	"client_key" text NOT NULL,
	"placed_at" timestamp with time zone NOT NULL,
	"settled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tote_bets_stake_positive" CHECK ("tote_bets"."stake" > 0),
	CONSTRAINT "tote_bets_payout_non_negative" CHECK ("tote_bets"."payout" >= 0),
	CONSTRAINT "tote_bets_currency" CHECK ("tote_bets"."currency" in ('CR', 'TUSDG'))
);
--> statement-breakpoint
CREATE TABLE "tote_pools" (
	"race_id" uuid NOT NULL,
	"pool" "tote_pool" NOT NULL,
	"currency" text NOT NULL,
	"outcome" text NOT NULL,
	"places" integer NOT NULL,
	"takeout_permille" integer NOT NULL,
	"total" bigint NOT NULL,
	"takeout" bigint NOT NULL,
	"paid" bigint NOT NULL,
	"remainder" bigint NOT NULL,
	"refunded" bigint NOT NULL,
	"tickets" integer NOT NULL,
	"winning_tickets" integer NOT NULL,
	"bettors" integer NOT NULL,
	"dividends" jsonb NOT NULL,
	"ledger_transaction_id" uuid,
	"settled_at" timestamp with time zone NOT NULL,
	CONSTRAINT "tote_pools_race_id_pool_currency_pk" PRIMARY KEY("race_id","pool","currency"),
	CONSTRAINT "tote_pools_balanced" CHECK ("tote_pools"."total" = "tote_pools"."paid" + "tote_pools"."takeout" + "tote_pools"."remainder")
);
--> statement-breakpoint
CREATE TABLE "tote_settings" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"adult_confirmed_at" timestamp with time zone,
	"limits" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"pending_limits" jsonb,
	"pending_at" timestamp with time zone,
	"excluded_until" timestamp with time zone,
	"excluded_permanent" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tote_bets" ADD CONSTRAINT "tote_bets_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tote_bets" ADD CONSTRAINT "tote_bets_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tote_bets" ADD CONSTRAINT "tote_bets_stable_id_stables_id_fk" FOREIGN KEY ("stable_id") REFERENCES "public"."stables"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tote_bets" ADD CONSTRAINT "tote_bets_horse_id_horses_id_fk" FOREIGN KEY ("horse_id") REFERENCES "public"."horses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tote_pools" ADD CONSTRAINT "tote_pools_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tote_settings" ADD CONSTRAINT "tote_settings_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tote_bets_client_key_uq" ON "tote_bets" USING btree ("account_id","client_key");--> statement-breakpoint
CREATE INDEX "tote_bets_race_idx" ON "tote_bets" USING btree ("race_id","pool","currency","status");--> statement-breakpoint
CREATE INDEX "tote_bets_account_idx" ON "tote_bets" USING btree ("account_id","placed_at");--> statement-breakpoint
CREATE INDEX "tote_bets_open_idx" ON "tote_bets" USING btree ("race_id") WHERE "tote_bets"."status" = 'open';--> statement-breakpoint
CREATE INDEX "tote_pools_settled_idx" ON "tote_pools" USING btree ("settled_at");