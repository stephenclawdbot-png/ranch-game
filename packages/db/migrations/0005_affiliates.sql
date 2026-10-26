CREATE TABLE "referral_earnings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" text NOT NULL,
	"level" integer NOT NULL,
	"inviter_account_id" uuid NOT NULL,
	"invitee_account_id" uuid NOT NULL,
	"wallet" text NOT NULL,
	"amount_wei" numeric(78, 0) NOT NULL,
	"usd_cents" integer NOT NULL,
	"deferred" boolean DEFAULT false NOT NULL,
	"tx_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "referral_earnings_level" CHECK ("referral_earnings"."level" in (1, 2))
);
--> statement-breakpoint
CREATE TABLE "referrals" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"inviter_account_id" uuid,
	"upstream_account_id" uuid,
	"via_code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	"activated_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "chain_orders" ADD COLUMN "ref1_account_id" uuid;--> statement-breakpoint
ALTER TABLE "chain_orders" ADD COLUMN "ref1_wallet" text;--> statement-breakpoint
ALTER TABLE "chain_orders" ADD COLUMN "ref1_bps" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "chain_orders" ADD COLUMN "ref2_account_id" uuid;--> statement-breakpoint
ALTER TABLE "chain_orders" ADD COLUMN "ref2_wallet" text;--> statement-breakpoint
ALTER TABLE "chain_orders" ADD COLUMN "ref2_bps" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "chain_orders" ADD COLUMN "pool_share_wei" numeric(78, 0);--> statement-breakpoint
ALTER TABLE "chain_orders" ADD COLUMN "treasury_wei" numeric(78, 0);--> statement-breakpoint
ALTER TABLE "invite_codes" ADD COLUMN "kind" text DEFAULT 'admin' NOT NULL;--> statement-breakpoint
ALTER TABLE "invite_codes" ADD COLUMN "owner_account_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "referral_earnings_uq" ON "referral_earnings" USING btree ("order_id","level");--> statement-breakpoint
CREATE INDEX "referral_earnings_inviter_idx" ON "referral_earnings" USING btree ("inviter_account_id","created_at");--> statement-breakpoint
CREATE INDEX "referrals_inviter_idx" ON "referrals" USING btree ("inviter_account_id");--> statement-breakpoint
CREATE INDEX "referrals_upstream_idx" ON "referrals" USING btree ("upstream_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invite_codes_referral_owner_uq" ON "invite_codes" USING btree ("owner_account_id") WHERE "invite_codes"."kind" = 'referral';--> statement-breakpoint
ALTER TABLE "invite_codes" ADD CONSTRAINT "invite_codes_kind" CHECK ("invite_codes"."kind" in ('admin', 'referral'));