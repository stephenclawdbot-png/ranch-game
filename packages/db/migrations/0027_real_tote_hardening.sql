ALTER TABLE "real_tote_permits" ADD COLUMN "runner" integer;--> statement-breakpoint
ALTER TABLE "real_tote_permits" ADD COLUMN "pool" text;--> statement-breakpoint
ALTER TABLE "real_tote_permits" ADD COLUMN "lapsed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "real_tote_races" ADD COLUMN "challenge_end_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "real_tote_races" ADD COLUMN "result_hash" text;--> statement-breakpoint
ALTER TABLE "real_tote_races" ADD COLUMN "attested_hash" text;--> statement-breakpoint
ALTER TABLE "real_tote_races" ADD COLUMN "disputed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "real_tote_races" ADD COLUMN "synced_block" bigint;--> statement-breakpoint
ALTER TABLE "real_tote_races" ADD COLUMN "keeper_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "real_tote_races" ADD COLUMN "keeper_next_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "real_tote_races" ADD COLUMN "keeper_error" text;--> statement-breakpoint
ALTER TABLE "real_tote_races" ADD COLUMN "parked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "real_tote_races" ADD COLUMN "guardian_request_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tote_settings" ADD COLUMN "self_excluded_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tote_settings" ADD COLUMN "self_exclusion_end_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tote_settings" ADD COLUMN "reality_check_ack_at" timestamp with time zone;