CREATE TABLE "real_tote_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"race_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"tx_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"block_number" bigint NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "real_tote_permits" (
	"nonce" text PRIMARY KEY NOT NULL,
	"race_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"wallet" text NOT NULL,
	"max_amount" bigint NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_amount" bigint,
	"bet_tx" text,
	CONSTRAINT "real_tote_permits_amount" CHECK ("real_tote_permits"."max_amount" > 0 and ("real_tote_permits"."used_amount" is null or ("real_tote_permits"."used_amount" > 0 and "real_tote_permits"."used_amount" <= "real_tote_permits"."max_amount")))
);
--> statement-breakpoint
CREATE TABLE "real_tote_races" (
	"race_id" uuid PRIMARY KEY NOT NULL,
	"market_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"field_lock_at" timestamp with time zone NOT NULL,
	"market_close_at" timestamp with time zone NOT NULL,
	"bets_close_at" timestamp with time zone NOT NULL,
	"entropy_block" bigint,
	"entropy" text,
	"seed_mode" text,
	"pools" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"void_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "real_tote_races_status" CHECK ("real_tote_races"."status" in ('pending', 'open', 'entropy_locked', 'sealed', 'abandoned', 'result_posted', 'finalized', 'void')),
	CONSTRAINT "real_tote_races_seed_mode" CHECK ("real_tote_races"."seed_mode" is null or "real_tote_races"."seed_mode" in ('final', 'server')),
	CONSTRAINT "real_tote_races_entropy" CHECK ("real_tote_races"."entropy" is null or "real_tote_races"."entropy" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "real_tote_events" ADD CONSTRAINT "real_tote_events_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "real_tote_permits" ADD CONSTRAINT "real_tote_permits_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "real_tote_permits" ADD CONSTRAINT "real_tote_permits_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "real_tote_races" ADD CONSTRAINT "real_tote_races_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "real_tote_events_log_uq" ON "real_tote_events" USING btree ("tx_hash","log_index");--> statement-breakpoint
CREATE INDEX "real_tote_events_race_idx" ON "real_tote_events" USING btree ("race_id","block_number");--> statement-breakpoint
CREATE INDEX "real_tote_permits_account_idx" ON "real_tote_permits" USING btree ("account_id","issued_at");--> statement-breakpoint
CREATE INDEX "real_tote_permits_race_idx" ON "real_tote_permits" USING btree ("race_id","account_id");--> statement-breakpoint
CREATE INDEX "real_tote_races_status_idx" ON "real_tote_races" USING btree ("status","market_close_at");