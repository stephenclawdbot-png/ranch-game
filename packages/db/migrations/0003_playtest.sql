CREATE TABLE "beta_reward_rules" (
	"key" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"amount_usd_cents" integer NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "beta_rewards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tester_id" uuid NOT NULL,
	"rule_key" text NOT NULL,
	"period" text NOT NULL,
	"amount_usd_cents" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"tx_hash" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "beta_rewards_status" CHECK ("beta_rewards"."status" in ('pending', 'approved', 'paid', 'void')),
	CONSTRAINT "beta_rewards_amount" CHECK ("beta_rewards"."amount_usd_cents" >= 0),
	CONSTRAINT "beta_rewards_tx" CHECK ("beta_rewards"."tx_hash" is null or "beta_rewards"."tx_hash" ~ '^0x[0-9a-fA-F]{64}$'),
	CONSTRAINT "beta_rewards_paid_tx" CHECK ("beta_rewards"."status" <> 'paid' or "beta_rewards"."tx_hash" is not null)
);
--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid,
	"tester_id" uuid,
	"stable_id" uuid,
	"sender_key" text NOT NULL,
	"category" text NOT NULL,
	"rating" integer,
	"message" text NOT NULL,
	"route" text,
	"viewport" text,
	"user_agent" text,
	"client_errors" jsonb,
	"status" text DEFAULT 'new' NOT NULL,
	"accepted_bug" boolean DEFAULT false NOT NULL,
	"admin_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "feedback_category" CHECK ("feedback"."category" in ('bug', 'idea', 'confusing', 'fun')),
	CONSTRAINT "feedback_status" CHECK ("feedback"."status" in ('new', 'resolved')),
	CONSTRAINT "feedback_rating" CHECK ("feedback"."rating" is null or "feedback"."rating" between 1 and 5),
	CONSTRAINT "feedback_message_len" CHECK (char_length("feedback"."message") between 1 and 4000)
);
--> statement-breakpoint
CREATE TABLE "invite_codes" (
	"code" text PRIMARY KEY NOT NULL,
	"max_uses" integer DEFAULT 1 NOT NULL,
	"uses" integer DEFAULT 0 NOT NULL,
	"note" text,
	"used_by" uuid,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invite_codes_uses" CHECK ("invite_codes"."uses" >= 0 and "invite_codes"."max_uses" >= 1 and "invite_codes"."uses" <= "invite_codes"."max_uses")
);
--> statement-breakpoint
CREATE TABLE "telemetry_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid,
	"tester_id" uuid,
	"name" text NOT NULL,
	"props" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tester_rewards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tester_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "testers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invite_code" text NOT NULL,
	"account_id" uuid,
	"stable_name" text,
	"wallet_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	CONSTRAINT "testers_wallet" CHECK ("testers"."wallet_address" is null or "testers"."wallet_address" ~ '^0x[0-9a-fA-F]{40}$')
);
--> statement-breakpoint
ALTER TABLE "beta_rewards" ADD CONSTRAINT "beta_rewards_tester_id_testers_id_fk" FOREIGN KEY ("tester_id") REFERENCES "public"."testers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tester_rewards" ADD CONSTRAINT "tester_rewards_tester_id_testers_id_fk" FOREIGN KEY ("tester_id") REFERENCES "public"."testers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "beta_rewards_uq" ON "beta_rewards" USING btree ("tester_id","rule_key","period");--> statement-breakpoint
CREATE INDEX "feedback_created_idx" ON "feedback" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "feedback_sender_idx" ON "feedback" USING btree ("sender_key","created_at");--> statement-breakpoint
CREATE INDEX "telemetry_name_idx" ON "telemetry_events" USING btree ("name","created_at");--> statement-breakpoint
CREATE INDEX "telemetry_account_idx" ON "telemetry_events" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "telemetry_tester_idx" ON "telemetry_events" USING btree ("tester_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tester_rewards_uq" ON "tester_rewards" USING btree ("tester_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "testers_account_uq" ON "testers" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "testers_invite_idx" ON "testers" USING btree ("invite_code");--> statement-breakpoint
INSERT INTO "beta_reward_rules" ("key", "label", "amount_usd_cents", "config") VALUES
  ('participation', 'Played on enough days of the beta', 1000, '{"minDays": 7}'::jsonb),
  ('weekly_top3', 'Weekly league: top 3', 1500, '{"byRankCents": [1500, 1000, 500]}'::jsonb),
  ('cup_champion', 'Daily Cup champion', 200, '{}'::jsonb),
  ('bug_bounty', 'Accepted bug report', 500, '{}'::jsonb),
  ('best_feedback', 'Best feedback pick', 1000, '{}'::jsonb)
ON CONFLICT ("key") DO NOTHING;
