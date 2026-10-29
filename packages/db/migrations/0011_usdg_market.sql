CREATE TABLE "usdg_bids" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"wallet" text NOT NULL,
	"amount" bigint NOT NULL,
	"nonce" text NOT NULL,
	"signature" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usdg_bids_amount" CHECK ("usdg_bids"."amount" > 0),
	CONSTRAINT "usdg_bids_status" CHECK ("usdg_bids"."status" in ('active', 'offered', 'won', 'defaulted', 'void'))
);
--> statement-breakpoint
CREATE TABLE "usdg_listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"horse_id" uuid NOT NULL,
	"seller_account_id" uuid NOT NULL,
	"seller_stable_id" uuid NOT NULL,
	"seller_wallet" text NOT NULL,
	"kind" text NOT NULL,
	"price" bigint NOT NULL,
	"appraisal" bigint NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"offer_order_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "usdg_listings_kind" CHECK ("usdg_listings"."kind" in ('fixed', 'auction')),
	CONSTRAINT "usdg_listings_status" CHECK ("usdg_listings"."status" in ('active', 'closed', 'sold', 'cancelled', 'expired', 'unsold')),
	CONSTRAINT "usdg_listings_price" CHECK ("usdg_listings"."price" > 0),
	CONSTRAINT "usdg_listings_ends" CHECK ("usdg_listings"."ends_at" > "usdg_listings"."created_at")
);
--> statement-breakpoint
CREATE TABLE "usdg_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" text NOT NULL,
	"kind" text NOT NULL,
	"account_id" uuid NOT NULL,
	"wallet" text NOT NULL,
	"horse_id" uuid NOT NULL,
	"horse_ref" text NOT NULL,
	"listing_id" uuid,
	"bid_id" uuid,
	"seller_account_id" uuid,
	"seller_wallet" text,
	"price" bigint NOT NULL,
	"fee" bigint NOT NULL,
	"token" text NOT NULL,
	"chain_id" integer NOT NULL,
	"market_address" text NOT NULL,
	"deadline" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"tx_hash" text,
	"flagged" boolean DEFAULT false NOT NULL,
	"flag_reason" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone,
	"fulfilled_at" timestamp with time zone,
	"expired_at" timestamp with time zone,
	CONSTRAINT "usdg_orders_kind" CHECK ("usdg_orders"."kind" in ('registration', 'sale')),
	CONSTRAINT "usdg_orders_status" CHECK ("usdg_orders"."status" in ('pending', 'paid', 'fulfilled', 'expired')),
	CONSTRAINT "usdg_orders_amounts" CHECK ("usdg_orders"."price" > 0 and "usdg_orders"."fee" >= 0 and "usdg_orders"."fee" <= "usdg_orders"."price"),
	CONSTRAINT "usdg_orders_order_hex" CHECK ("usdg_orders"."order_id" ~ '^0x[0-9a-f]{64}$'),
	CONSTRAINT "usdg_orders_tx_hex" CHECK ("usdg_orders"."tx_hash" is null or "usdg_orders"."tx_hash" ~ '^0x[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "usdg_registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"horse_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"order_id" text NOT NULL,
	"wallet" text NOT NULL,
	"fee" bigint NOT NULL,
	"tx_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "usdg_bids" ADD CONSTRAINT "usdg_bids_listing_id_usdg_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."usdg_listings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usdg_listings" ADD CONSTRAINT "usdg_listings_horse_id_horses_id_fk" FOREIGN KEY ("horse_id") REFERENCES "public"."horses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usdg_listings" ADD CONSTRAINT "usdg_listings_seller_stable_id_stables_id_fk" FOREIGN KEY ("seller_stable_id") REFERENCES "public"."stables"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usdg_registrations" ADD CONSTRAINT "usdg_registrations_horse_id_horses_id_fk" FOREIGN KEY ("horse_id") REFERENCES "public"."horses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "usdg_bids_signature_uq" ON "usdg_bids" USING btree ("signature");--> statement-breakpoint
CREATE UNIQUE INDEX "usdg_bids_nonce_uq" ON "usdg_bids" USING btree ("listing_id","account_id","nonce");--> statement-breakpoint
CREATE INDEX "usdg_bids_listing_idx" ON "usdg_bids" USING btree ("listing_id","amount");--> statement-breakpoint
CREATE UNIQUE INDEX "usdg_listings_horse_open_uq" ON "usdg_listings" USING btree ("horse_id") WHERE "usdg_listings"."status" in ('active', 'closed');--> statement-breakpoint
CREATE INDEX "usdg_listings_status_idx" ON "usdg_listings" USING btree ("status","ends_at");--> statement-breakpoint
CREATE INDEX "usdg_listings_seller_idx" ON "usdg_listings" USING btree ("seller_stable_id");--> statement-breakpoint
CREATE UNIQUE INDEX "usdg_orders_order_uq" ON "usdg_orders" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "usdg_orders_tx_uq" ON "usdg_orders" USING btree ("tx_hash");--> statement-breakpoint
CREATE INDEX "usdg_orders_account_idx" ON "usdg_orders" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "usdg_orders_status_idx" ON "usdg_orders" USING btree ("status","deadline");--> statement-breakpoint
CREATE INDEX "usdg_orders_listing_idx" ON "usdg_orders" USING btree ("listing_id");--> statement-breakpoint
CREATE UNIQUE INDEX "usdg_registrations_horse_uq" ON "usdg_registrations" USING btree ("horse_id");--> statement-breakpoint
CREATE UNIQUE INDEX "usdg_registrations_order_uq" ON "usdg_registrations" USING btree ("order_id");