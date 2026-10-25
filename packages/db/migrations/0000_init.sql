CREATE TYPE "public"."account_link_kind" AS ENUM('device', 'fingerprint', 'ip_hash', 'wallet', 'email');--> statement-breakpoint
CREATE TYPE "public"."career_status" AS ENUM('racing', 'retired', 'pasture');--> statement-breakpoint
CREATE TYPE "public"."entry_movement_kind" AS ENUM('daily', 'refill', 'race', 'refund', 'adjustment');--> statement-breakpoint
CREATE TYPE "public"."entry_status" AS ENUM('entered', 'scratched');--> statement-breakpoint
CREATE TYPE "public"."horse_lock" AS ENUM('race', 'market');--> statement-breakpoint
CREATE TYPE "public"."horse_origin" AS ENUM('starter', 'bred', 'pack', 'gift', 'house', 'admin');--> statement-breakpoint
CREATE TYPE "public"."horse_sex" AS ENUM('male', 'female');--> statement-breakpoint
CREATE TYPE "public"."horse_stage" AS ENUM('foal', 'weanling', 'yearling', 'juvenile', 'prime', 'veteran');--> statement-breakpoint
CREATE TYPE "public"."ledger_account_kind" AS ENUM('player', 'mint', 'burn', 'treasury', 'escrow');--> statement-breakpoint
CREATE TYPE "public"."listing_status" AS ENUM('active', 'sold', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."maturity_type" AS ENUM('early', 'normal', 'late');--> statement-breakpoint
CREATE TYPE "public"."pregnancy_status" AS ENUM('carrying', 'foaled', 'lost');--> statement-breakpoint
CREATE TYPE "public"."race_kind" AS ENUM('quick', 'scheduled', 'daily_cup', 'feature', 'final', 'trial');--> statement-breakpoint
CREATE TYPE "public"."race_status" AS ENUM('open', 'locked', 'settled', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."rarity" AS ENUM('common', 'uncommon', 'rare', 'epic', 'legendary');--> statement-breakpoint
CREATE TYPE "public"."retirement_reason" AS ENUM('choice', 'max_starts', 'injury');--> statement-breakpoint
CREATE TYPE "public"."season_status" AS ENUM('upcoming', 'active', 'closed');--> statement-breakpoint
CREATE TABLE "account_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"kind" "account_link_kind" NOT NULL,
	"value_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account_play_days" (
	"account_id" uuid NOT NULL,
	"day" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_play_days_account_id_day_pk" PRIMARY KEY("account_id","day")
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"display_name" text,
	"email" text,
	"wallet_address" text,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"timezone_changed_at" timestamp with time zone,
	"email_verified_at" timestamp with time zone,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "achievements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"code" text NOT NULL,
	"horse_id" uuid,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_account_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "breeding_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sire_id" uuid NOT NULL,
	"dam_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"sire_owner_stable_id" uuid,
	"dam_owner_stable_id" uuid,
	"season_number" integer NOT NULL,
	"base_fee" bigint DEFAULT 0 NOT NULL,
	"stud_fee" bigint DEFAULT 0 NOT NULL,
	"coi_bp" integer DEFAULT 0 NOT NULL,
	"ledger_transaction_id" uuid,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "breeding_events_not_self" CHECK ("breeding_events"."sire_id" <> "breeding_events"."dam_id")
);
--> statement-breakpoint
CREATE TABLE "care_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"horse_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"day" date NOT NULL,
	"actions" jsonb NOT NULL,
	"quality" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_cup_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"day" date NOT NULL,
	"account_id" uuid NOT NULL,
	"horse_id" uuid NOT NULL,
	"race_id" uuid,
	"snapshot" jsonb NOT NULL,
	"finish_position" integer,
	"finish_time_us" bigint,
	"points" integer DEFAULT 0 NOT NULL,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "economy_config" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"description" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entry_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stable_id" uuid NOT NULL,
	"kind" "entry_movement_kind" NOT NULL,
	"delta" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"local_date" date,
	"race_id" uuid,
	"horse_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entry_movements_balance" CHECK ("entry_movements"."balance_after" >= 0)
);
--> statement-breakpoint
CREATE TABLE "foal_crop" (
	"season_number" integer PRIMARY KEY NOT NULL,
	"cap" integer NOT NULL,
	"produced" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "foal_crop_bounds" CHECK ("foal_crop"."produced" between 0 and "foal_crop"."cap")
);
--> statement-breakpoint
CREATE TABLE "fraud_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid,
	"related_account_id" uuid,
	"kind" text NOT NULL,
	"severity" integer DEFAULT 1 NOT NULL,
	"data" jsonb,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hall_of_fame" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_key" text NOT NULL,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"horse_id" uuid,
	"account_id" uuid,
	"season_number" integer,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "horses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_stable_id" uuid,
	"name" text NOT NULL,
	"sex" "horse_sex" NOT NULL,
	"gelded" boolean DEFAULT false NOT NULL,
	"sire_id" uuid,
	"dam_id" uuid,
	"generation" integer DEFAULT 0 NOT NULL,
	"origin" "horse_origin" NOT NULL,
	"birth_season_number" integer,
	"born_at" timestamp with time zone DEFAULT now() NOT NULL,
	"genome" jsonb NOT NULL,
	"appearance" jsonb NOT NULL,
	"stats" jsonb NOT NULL,
	"maturity_type" "maturity_type" DEFAULT 'normal' NOT NULL,
	"rating" integer DEFAULT 0 NOT NULL,
	"stage" "horse_stage" NOT NULL,
	"career_status" "career_status" DEFAULT 'racing' NOT NULL,
	"retirement_reason" "retirement_reason",
	"retired_at" timestamp with time zone,
	"pastured_at" timestamp with time zone,
	"care_sessions" integer DEFAULT 0 NOT NULL,
	"care_quality" integer DEFAULT 0 NOT NULL,
	"fitness" integer DEFAULT 500 NOT NULL,
	"fatigue" integer DEFAULT 0 NOT NULL,
	"freshness" integer DEFAULT 1000 NOT NULL,
	"form" integer DEFAULT 500 NOT NULL,
	"morale" integer DEFAULT 500 NOT NULL,
	"bond" integer DEFAULT 0 NOT NULL,
	"dynamics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"quirks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"scanned" boolean DEFAULT false NOT NULL,
	"injury" jsonb,
	"injured_until" timestamp with time zone,
	"insured" boolean DEFAULT false NOT NULL,
	"breeding_count" integer DEFAULT 0 NOT NULL,
	"stud_fee" bigint,
	"bound" boolean DEFAULT false NOT NULL,
	"trade_min_starts" integer DEFAULT 0 NOT NULL,
	"released_at" timestamp with time zone,
	"released_from_stable_id" uuid,
	"lock_kind" "horse_lock",
	"lock_ref" uuid,
	"starts" integer DEFAULT 0 NOT NULL,
	"wins" integer DEFAULT 0 NOT NULL,
	"places" integer DEFAULT 0 NOT NULL,
	"shows" integer DEFAULT 0 NOT NULL,
	"earnings" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "horses_breeding_count" CHECK ("horses"."breeding_count" between 0 and 4),
	CONSTRAINT "horses_not_own_parent" CHECK ("horses"."sire_id" is distinct from "horses"."id" and "horses"."dam_id" is distinct from "horses"."id"),
	CONSTRAINT "horses_distinct_parents" CHECK ("horses"."sire_id" is null or "horses"."dam_id" is null or "horses"."sire_id" <> "horses"."dam_id"),
	CONSTRAINT "horses_lock_consistent" CHECK (("horses"."lock_kind" is null) = ("horses"."lock_ref" is null)),
	CONSTRAINT "horses_rating" CHECK ("horses"."rating" between 0 and 140),
	CONSTRAINT "horses_stud_fee" CHECK ("horses"."stud_fee" is null or "horses"."stud_fee" >= 0),
	CONSTRAINT "horses_name_len" CHECK (char_length("horses"."name") between 1 and 32),
	CONSTRAINT "horses_starts" CHECK ("horses"."starts" between 0 and 40 and "horses"."wins" + "horses"."places" + "horses"."shows" <= "horses"."starts"),
	CONSTRAINT "horses_meters" CHECK (least("horses"."fitness", "horses"."fatigue", "horses"."freshness", "horses"."form", "horses"."morale", "horses"."bond", "horses"."care_quality") >= 0 and greatest("horses"."fitness", "horses"."fatigue", "horses"."freshness", "horses"."form", "horses"."morale", "horses"."bond", "horses"."care_quality") <= 1000),
	CONSTRAINT "horses_retirement_consistent" CHECK (("horses"."career_status" = 'racing') = ("horses"."retirement_reason" is null) and ("horses"."career_status" = 'racing') = ("horses"."retired_at" is null)),
	CONSTRAINT "horses_pasture_consistent" CHECK (("horses"."career_status" = 'pasture') = ("horses"."pastured_at" is not null)),
	CONSTRAINT "horses_mandatory_retirement" CHECK ("horses"."starts" < 40 or "horses"."career_status" <> 'racing')
);
--> statement-breakpoint
CREATE TABLE "inbox_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"title" text NOT NULL,
	"data" jsonb,
	"race_id" uuid,
	"horse_id" uuid,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "league_members" (
	"league_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"week_start" date NOT NULL,
	"points" integer DEFAULT 0 NOT NULL,
	"final_rank" integer,
	"movement" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "league_members_league_id_account_id_pk" PRIMARY KEY("league_id","account_id")
);
--> statement-breakpoint
CREATE TABLE "leagues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_number" integer NOT NULL,
	"week_start" date NOT NULL,
	"tier" integer NOT NULL,
	"name" text NOT NULL,
	"capacity" integer DEFAULT 30 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "ledger_account_kind" NOT NULL,
	"owner_account_id" uuid,
	"currency" text DEFAULT 'CR' NOT NULL,
	"balance" bigint DEFAULT 0 NOT NULL,
	"allow_negative" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_accounts_non_negative" CHECK ("ledger_accounts"."allow_negative" or "ledger_accounts"."balance" >= 0),
	CONSTRAINT "ledger_accounts_owner_kind" CHECK (("ledger_accounts"."kind" = 'player') = ("ledger_accounts"."owner_account_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "ledger_postings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"ledger_account_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_postings_nonzero" CHECK ("ledger_postings"."amount" <> 0)
);
--> statement-breakpoint
CREATE TABLE "ledger_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"idempotency_key" text NOT NULL,
	"kind" text NOT NULL,
	"memo" text,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lineage_edges" (
	"ancestor_id" uuid NOT NULL,
	"descendant_id" uuid NOT NULL,
	"depth" integer NOT NULL,
	"paths" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "lineage_edges_ancestor_id_descendant_id_depth_pk" PRIMARY KEY("ancestor_id","descendant_id","depth"),
	CONSTRAINT "lineage_depth" CHECK ("lineage_edges"."depth" >= 1),
	CONSTRAINT "lineage_not_self" CHECK ("lineage_edges"."ancestor_id" <> "lineage_edges"."descendant_id")
);
--> statement-breakpoint
CREATE TABLE "market_listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"horse_id" uuid NOT NULL,
	"seller_stable_id" uuid NOT NULL,
	"price" bigint NOT NULL,
	"appraisal" bigint NOT NULL,
	"status" "listing_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "market_listings_price" CHECK ("market_listings"."price" > 0),
	CONSTRAINT "market_listings_expiry" CHECK ("market_listings"."expires_at" > "market_listings"."created_at")
);
--> statement-breakpoint
CREATE TABLE "pack_pity" (
	"account_id" uuid NOT NULL,
	"pack_type" text NOT NULL,
	"total_pulls" integer DEFAULT 0 NOT NULL,
	"since_rare" integer DEFAULT 0 NOT NULL,
	"since_epic" integer DEFAULT 0 NOT NULL,
	"next_seed_commitment" text NOT NULL,
	"next_seed" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pack_pity_account_id_pack_type_pk" PRIMARY KEY("account_id","pack_type")
);
--> statement-breakpoint
CREATE TABLE "pack_pulls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"pack_type" text NOT NULL,
	"pull_index" integer NOT NULL,
	"seed_commitment" text NOT NULL,
	"seed_reveal" text NOT NULL,
	"rarity" "rarity" NOT NULL,
	"pity_applied" text,
	"horse_id" uuid,
	"price" bigint DEFAULT 0 NOT NULL,
	"free" boolean DEFAULT false NOT NULL,
	"week_start" date NOT NULL,
	"season_number" integer NOT NULL,
	"ledger_transaction_id" uuid,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pregnancies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"breeding_event_id" uuid NOT NULL,
	"sire_id" uuid NOT NULL,
	"dam_id" uuid NOT NULL,
	"conceived_at" timestamp with time zone NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"status" "pregnancy_status" DEFAULT 'carrying' NOT NULL,
	"seed_commitment" text NOT NULL,
	"seed" text NOT NULL,
	"seed_revealed" boolean DEFAULT false NOT NULL,
	"foal_id" uuid,
	"foaled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "race_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"race_id" uuid NOT NULL,
	"horse_id" uuid NOT NULL,
	"stable_id" uuid,
	"status" "entry_status" DEFAULT 'entered' NOT NULL,
	"is_house" boolean DEFAULT false NOT NULL,
	"entry_cost" integer DEFAULT 0 NOT NULL,
	"gate" integer,
	"tactic" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"weight_kg" integer,
	"finish_position" integer,
	"finish_time_us" bigint,
	"prize" bigint DEFAULT 0 NOT NULL,
	"rating_before" integer NOT NULL,
	"rating_after" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"scratched_at" timestamp with time zone,
	CONSTRAINT "race_entries_gate" CHECK ("race_entries"."gate" is null or "race_entries"."gate" between 1 and 16)
);
--> statement-breakpoint
CREATE TABLE "race_results" (
	"race_id" uuid PRIMARY KEY NOT NULL,
	"seed_commitment" text NOT NULL,
	"seed_reveal" text NOT NULL,
	"result_hash" text NOT NULL,
	"engine_version" text,
	"result" jsonb NOT NULL,
	"ledger_transaction_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "races" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "race_kind" NOT NULL,
	"name" text NOT NULL,
	"race_class" text NOT NULL,
	"season_number" integer,
	"conditions" jsonb NOT NULL,
	"post_time" timestamp with time zone NOT NULL,
	"entries_close_at" timestamp with time zone NOT NULL,
	"status" "race_status" DEFAULT 'open' NOT NULL,
	"slot_key" text,
	"max_runners" integer DEFAULT 12 NOT NULL,
	"target_runners" integer DEFAULT 10 NOT NULL,
	"entry_cost" integer DEFAULT 0 NOT NULL,
	"field" jsonb,
	"field_hash" text,
	"locked_at" timestamp with time zone,
	"purse" bigint DEFAULT 0 NOT NULL,
	"entry_fee" bigint DEFAULT 0 NOT NULL,
	"seed_commitment" text NOT NULL,
	"seed" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone,
	CONSTRAINT "races_target" CHECK ("races"."target_runners" between 2 and "races"."max_runners" and "races"."entry_cost" between 0 and 2),
	CONSTRAINT "races_close_before_post" CHECK ("races"."entries_close_at" <= "races"."post_time"),
	CONSTRAINT "races_runners" CHECK ("races"."max_runners" between 2 and 16),
	CONSTRAINT "races_money" CHECK ("races"."purse" >= 0 and "races"."entry_fee" >= 0)
);
--> statement-breakpoint
CREATE TABLE "seasons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" integer NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" "season_status" DEFAULT 'upcoming' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seasons_range" CHECK ("seasons"."ends_at" > "seasons"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "stables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"name" text NOT NULL,
	"silks" jsonb NOT NULL,
	"stall_slots" integer DEFAULT 6 NOT NULL,
	"licence_level" integer DEFAULT 1 NOT NULL,
	"facilities" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"entry_balance" integer DEFAULT 0 NOT NULL,
	"entry_allowance" integer DEFAULT 10 NOT NULL,
	"entry_cap" integer DEFAULT 20 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stables_entry_balance" CHECK ("stables"."entry_balance" >= 0),
	CONSTRAINT "stables_entry_tiers" CHECK ("stables"."entry_allowance" between 1 and 15 and "stables"."entry_cap" between "stables"."entry_allowance" and 30),
	CONSTRAINT "stables_name_len" CHECK (char_length("stables"."name") between 1 and 40),
	CONSTRAINT "stables_slots" CHECK ("stables"."stall_slots" between 1 and 24)
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid NOT NULL,
	"horse_id" uuid NOT NULL,
	"seller_stable_id" uuid NOT NULL,
	"buyer_stable_id" uuid NOT NULL,
	"price" bigint NOT NULL,
	"fee" bigint NOT NULL,
	"ledger_transaction_id" uuid NOT NULL,
	"flagged" boolean DEFAULT false NOT NULL,
	"flag_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trades_parties" CHECK ("trades"."seller_stable_id" <> "trades"."buyer_stable_id")
);
--> statement-breakpoint
CREATE TABLE "training_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"horse_id" uuid NOT NULL,
	"week_start" date NOT NULL,
	"plan" jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account_links" ADD CONSTRAINT "account_links_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_play_days" ADD CONSTRAINT "account_play_days_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "achievements" ADD CONSTRAINT "achievements_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "achievements" ADD CONSTRAINT "achievements_horse_id_horses_id_fk" FOREIGN KEY ("horse_id") REFERENCES "public"."horses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_account_id_accounts_id_fk" FOREIGN KEY ("actor_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "breeding_events" ADD CONSTRAINT "breeding_events_sire_id_horses_id_fk" FOREIGN KEY ("sire_id") REFERENCES "public"."horses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "breeding_events" ADD CONSTRAINT "breeding_events_dam_id_horses_id_fk" FOREIGN KEY ("dam_id") REFERENCES "public"."horses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "breeding_events" ADD CONSTRAINT "breeding_events_requested_by_accounts_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "breeding_events" ADD CONSTRAINT "breeding_events_sire_owner_stable_id_stables_id_fk" FOREIGN KEY ("sire_owner_stable_id") REFERENCES "public"."stables"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "breeding_events" ADD CONSTRAINT "breeding_events_dam_owner_stable_id_stables_id_fk" FOREIGN KEY ("dam_owner_stable_id") REFERENCES "public"."stables"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "breeding_events" ADD CONSTRAINT "breeding_events_ledger_transaction_id_ledger_transactions_id_fk" FOREIGN KEY ("ledger_transaction_id") REFERENCES "public"."ledger_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_log" ADD CONSTRAINT "care_log_horse_id_horses_id_fk" FOREIGN KEY ("horse_id") REFERENCES "public"."horses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_log" ADD CONSTRAINT "care_log_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_cup_entries" ADD CONSTRAINT "daily_cup_entries_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_cup_entries" ADD CONSTRAINT "daily_cup_entries_horse_id_horses_id_fk" FOREIGN KEY ("horse_id") REFERENCES "public"."horses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_cup_entries" ADD CONSTRAINT "daily_cup_entries_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_movements" ADD CONSTRAINT "entry_movements_stable_id_stables_id_fk" FOREIGN KEY ("stable_id") REFERENCES "public"."stables"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_movements" ADD CONSTRAINT "entry_movements_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_movements" ADD CONSTRAINT "entry_movements_horse_id_horses_id_fk" FOREIGN KEY ("horse_id") REFERENCES "public"."horses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fraud_events" ADD CONSTRAINT "fraud_events_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fraud_events" ADD CONSTRAINT "fraud_events_related_account_id_accounts_id_fk" FOREIGN KEY ("related_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hall_of_fame" ADD CONSTRAINT "hall_of_fame_horse_id_horses_id_fk" FOREIGN KEY ("horse_id") REFERENCES "public"."horses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hall_of_fame" ADD CONSTRAINT "hall_of_fame_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "horses" ADD CONSTRAINT "horses_owner_stable_id_stables_id_fk" FOREIGN KEY ("owner_stable_id") REFERENCES "public"."stables"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "horses" ADD CONSTRAINT "horses_sire_id_horses_id_fk" FOREIGN KEY ("sire_id") REFERENCES "public"."horses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "horses" ADD CONSTRAINT "horses_dam_id_horses_id_fk" FOREIGN KEY ("dam_id") REFERENCES "public"."horses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "horses" ADD CONSTRAINT "horses_released_from_stable_id_stables_id_fk" FOREIGN KEY ("released_from_stable_id") REFERENCES "public"."stables"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD CONSTRAINT "inbox_items_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD CONSTRAINT "inbox_items_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD CONSTRAINT "inbox_items_horse_id_horses_id_fk" FOREIGN KEY ("horse_id") REFERENCES "public"."horses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_members" ADD CONSTRAINT "league_members_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_members" ADD CONSTRAINT "league_members_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_owner_account_id_accounts_id_fk" FOREIGN KEY ("owner_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_postings" ADD CONSTRAINT "ledger_postings_transaction_id_ledger_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."ledger_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_postings" ADD CONSTRAINT "ledger_postings_ledger_account_id_ledger_accounts_id_fk" FOREIGN KEY ("ledger_account_id") REFERENCES "public"."ledger_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lineage_edges" ADD CONSTRAINT "lineage_edges_ancestor_id_horses_id_fk" FOREIGN KEY ("ancestor_id") REFERENCES "public"."horses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lineage_edges" ADD CONSTRAINT "lineage_edges_descendant_id_horses_id_fk" FOREIGN KEY ("descendant_id") REFERENCES "public"."horses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_listings" ADD CONSTRAINT "market_listings_horse_id_horses_id_fk" FOREIGN KEY ("horse_id") REFERENCES "public"."horses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_listings" ADD CONSTRAINT "market_listings_seller_stable_id_stables_id_fk" FOREIGN KEY ("seller_stable_id") REFERENCES "public"."stables"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pack_pity" ADD CONSTRAINT "pack_pity_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pack_pulls" ADD CONSTRAINT "pack_pulls_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pack_pulls" ADD CONSTRAINT "pack_pulls_horse_id_horses_id_fk" FOREIGN KEY ("horse_id") REFERENCES "public"."horses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pack_pulls" ADD CONSTRAINT "pack_pulls_ledger_transaction_id_ledger_transactions_id_fk" FOREIGN KEY ("ledger_transaction_id") REFERENCES "public"."ledger_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pregnancies" ADD CONSTRAINT "pregnancies_breeding_event_id_breeding_events_id_fk" FOREIGN KEY ("breeding_event_id") REFERENCES "public"."breeding_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pregnancies" ADD CONSTRAINT "pregnancies_sire_id_horses_id_fk" FOREIGN KEY ("sire_id") REFERENCES "public"."horses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pregnancies" ADD CONSTRAINT "pregnancies_dam_id_horses_id_fk" FOREIGN KEY ("dam_id") REFERENCES "public"."horses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pregnancies" ADD CONSTRAINT "pregnancies_foal_id_horses_id_fk" FOREIGN KEY ("foal_id") REFERENCES "public"."horses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "race_entries" ADD CONSTRAINT "race_entries_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "race_entries" ADD CONSTRAINT "race_entries_horse_id_horses_id_fk" FOREIGN KEY ("horse_id") REFERENCES "public"."horses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "race_entries" ADD CONSTRAINT "race_entries_stable_id_stables_id_fk" FOREIGN KEY ("stable_id") REFERENCES "public"."stables"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "race_results" ADD CONSTRAINT "race_results_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "race_results" ADD CONSTRAINT "race_results_ledger_transaction_id_ledger_transactions_id_fk" FOREIGN KEY ("ledger_transaction_id") REFERENCES "public"."ledger_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stables" ADD CONSTRAINT "stables_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_listing_id_market_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."market_listings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_horse_id_horses_id_fk" FOREIGN KEY ("horse_id") REFERENCES "public"."horses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_seller_stable_id_stables_id_fk" FOREIGN KEY ("seller_stable_id") REFERENCES "public"."stables"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_buyer_stable_id_stables_id_fk" FOREIGN KEY ("buyer_stable_id") REFERENCES "public"."stables"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_ledger_transaction_id_ledger_transactions_id_fk" FOREIGN KEY ("ledger_transaction_id") REFERENCES "public"."ledger_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_plans" ADD CONSTRAINT "training_plans_horse_id_horses_id_fk" FOREIGN KEY ("horse_id") REFERENCES "public"."horses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_plans" ADD CONSTRAINT "training_plans_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_links_account_signal_uq" ON "account_links" USING btree ("account_id","kind","value_hash");--> statement-breakpoint
CREATE INDEX "account_links_signal_idx" ON "account_links" USING btree ("kind","value_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_token_hash_uq" ON "accounts" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_email_uq" ON "accounts" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_wallet_uq" ON "accounts" USING btree ("wallet_address");--> statement-breakpoint
CREATE UNIQUE INDEX "achievements_account_code_uq" ON "achievements" USING btree ("account_id","code");--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_log_actor_idx" ON "audit_log" USING btree ("actor_account_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "breeding_events_idem_uq" ON "breeding_events" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "breeding_events_dam_season_uq" ON "breeding_events" USING btree ("dam_id","season_number");--> statement-breakpoint
CREATE INDEX "breeding_events_sire_season_idx" ON "breeding_events" USING btree ("sire_id","season_number");--> statement-breakpoint
CREATE UNIQUE INDEX "care_log_horse_day_uq" ON "care_log" USING btree ("horse_id","day");--> statement-breakpoint
CREATE INDEX "care_log_account_idx" ON "care_log" USING btree ("account_id","day");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_cup_account_day_uq" ON "daily_cup_entries" USING btree ("account_id","day");--> statement-breakpoint
CREATE INDEX "daily_cup_board_idx" ON "daily_cup_entries" USING btree ("day","points","finish_time_us");--> statement-breakpoint
CREATE UNIQUE INDEX "entry_movements_grant_uq" ON "entry_movements" USING btree ("stable_id","local_date","kind") WHERE "entry_movements"."kind" in ('daily', 'refill');--> statement-breakpoint
CREATE UNIQUE INDEX "entry_movements_refund_uq" ON "entry_movements" USING btree ("race_id","horse_id") WHERE "entry_movements"."kind" = 'refund';--> statement-breakpoint
CREATE INDEX "entry_movements_stable_idx" ON "entry_movements" USING btree ("stable_id","created_at");--> statement-breakpoint
CREATE INDEX "fraud_events_account_idx" ON "fraud_events" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "fraud_events_kind_idx" ON "fraud_events" USING btree ("kind","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "hall_of_fame_key_uq" ON "hall_of_fame" USING btree ("entry_key");--> statement-breakpoint
CREATE INDEX "hall_of_fame_category_idx" ON "hall_of_fame" USING btree ("category","created_at");--> statement-breakpoint
CREATE INDEX "horses_owner_idx" ON "horses" USING btree ("owner_stable_id");--> statement-breakpoint
CREATE INDEX "horses_sire_idx" ON "horses" USING btree ("sire_id");--> statement-breakpoint
CREATE INDEX "horses_dam_idx" ON "horses" USING btree ("dam_id");--> statement-breakpoint
CREATE INDEX "horses_rating_idx" ON "horses" USING btree ("rating");--> statement-breakpoint
CREATE INDEX "horses_owner_status_idx" ON "horses" USING btree ("owner_stable_id","career_status");--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_items_dedupe_uq" ON "inbox_items" USING btree ("account_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "inbox_items_account_idx" ON "inbox_items" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "league_members_account_week_uq" ON "league_members" USING btree ("account_id","week_start");--> statement-breakpoint
CREATE INDEX "league_members_points_idx" ON "league_members" USING btree ("league_id","points");--> statement-breakpoint
CREATE INDEX "leagues_week_tier_idx" ON "leagues" USING btree ("week_start","tier");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_accounts_owner_uq" ON "ledger_accounts" USING btree ("owner_account_id","kind","currency");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_accounts_system_uq" ON "ledger_accounts" USING btree ("kind","currency") WHERE "ledger_accounts"."owner_account_id" is null;--> statement-breakpoint
CREATE INDEX "ledger_postings_txn_idx" ON "ledger_postings" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "ledger_postings_account_idx" ON "ledger_postings" USING btree ("ledger_account_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_transactions_idem_uq" ON "ledger_transactions" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "ledger_transactions_kind_idx" ON "ledger_transactions" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "lineage_descendant_idx" ON "lineage_edges" USING btree ("descendant_id","depth");--> statement-breakpoint
CREATE UNIQUE INDEX "market_listings_horse_active_uq" ON "market_listings" USING btree ("horse_id") WHERE "market_listings"."status" = 'active';--> statement-breakpoint
CREATE INDEX "market_listings_status_idx" ON "market_listings" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "market_listings_seller_idx" ON "market_listings" USING btree ("seller_stable_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pack_pulls_idem_uq" ON "pack_pulls" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "pack_pulls_week_idx" ON "pack_pulls" USING btree ("account_id","pack_type","week_start");--> statement-breakpoint
CREATE UNIQUE INDEX "pack_pulls_account_index_uq" ON "pack_pulls" USING btree ("account_id","pack_type","pull_index");--> statement-breakpoint
CREATE UNIQUE INDEX "pregnancies_event_uq" ON "pregnancies" USING btree ("breeding_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pregnancies_foal_uq" ON "pregnancies" USING btree ("foal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pregnancies_dam_carrying_uq" ON "pregnancies" USING btree ("dam_id") WHERE "pregnancies"."status" = 'carrying';--> statement-breakpoint
CREATE INDEX "pregnancies_due_idx" ON "pregnancies" USING btree ("status","due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "race_entries_race_horse_uq" ON "race_entries" USING btree ("race_id","horse_id");--> statement-breakpoint
CREATE UNIQUE INDEX "race_entries_race_gate_uq" ON "race_entries" USING btree ("race_id","gate");--> statement-breakpoint
CREATE INDEX "race_entries_horse_idx" ON "race_entries" USING btree ("horse_id","created_at");--> statement-breakpoint
CREATE INDEX "race_entries_stable_idx" ON "race_entries" USING btree ("stable_id","created_at");--> statement-breakpoint
CREATE INDEX "races_post_time_idx" ON "races" USING btree ("post_time");--> statement-breakpoint
CREATE INDEX "races_status_idx" ON "races" USING btree ("status","post_time");--> statement-breakpoint
CREATE UNIQUE INDEX "races_slot_uq" ON "races" USING btree ("slot_key");--> statement-breakpoint
CREATE UNIQUE INDEX "seasons_number_uq" ON "seasons" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "stables_account_uq" ON "stables" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trades_listing_uq" ON "trades" USING btree ("listing_id");--> statement-breakpoint
CREATE INDEX "trades_horse_idx" ON "trades" USING btree ("horse_id");--> statement-breakpoint
CREATE UNIQUE INDEX "training_plans_horse_week_uq" ON "training_plans" USING btree ("horse_id","week_start");