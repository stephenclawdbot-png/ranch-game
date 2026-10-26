CREATE TABLE "chain_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" text NOT NULL,
	"account_id" uuid NOT NULL,
	"tester_id" uuid,
	"wallet" text NOT NULL,
	"sku" text NOT NULL,
	"quantity" integer NOT NULL,
	"usd_cents" integer NOT NULL,
	"price_wei" numeric(78, 0) NOT NULL,
	"eth_usd_micros" bigint NOT NULL,
	"price_sources" jsonb,
	"chain_id" integer NOT NULL,
	"store_address" text NOT NULL,
	"deadline" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'quoted' NOT NULL,
	"tx_hash" text,
	"pull_ids" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone,
	"fulfilled_at" timestamp with time zone,
	CONSTRAINT "chain_orders_status" CHECK ("chain_orders"."status" in ('quoted', 'submitted', 'paid', 'fulfilled', 'expired', 'rejected')),
	CONSTRAINT "chain_orders_qty" CHECK ("chain_orders"."quantity" between 1 and 10),
	CONSTRAINT "chain_orders_order_hex" CHECK ("chain_orders"."order_id" ~ '^0x[0-9a-f]{64}$'),
	CONSTRAINT "chain_orders_tx_hex" CHECK ("chain_orders"."tx_hash" is null or "chain_orders"."tx_hash" ~ '^0x[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "pool_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"epoch_row_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"tester_id" uuid,
	"wallet" text NOT NULL,
	"stable_name" text,
	"rank" integer NOT NULL,
	"score" integer NOT NULL,
	"active_days" integer NOT NULL,
	"usd_cents" integer NOT NULL,
	"amount_wei" numeric(78, 0) NOT NULL,
	"leaf" text NOT NULL,
	"proof" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pool_epochs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chain_id" integer NOT NULL,
	"pool_address" text NOT NULL,
	"epoch_id" integer NOT NULL,
	"kind" text DEFAULT 'weekly' NOT NULL,
	"week_start" date NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"root" text NOT NULL,
	"total_wei" numeric(78, 0) NOT NULL,
	"leaf_count" integer NOT NULL,
	"available_wei" numeric(78, 0) NOT NULL,
	"eth_usd_micros" bigint NOT NULL,
	"price_sources" jsonb,
	"config" jsonb NOT NULL,
	"vest_start" timestamp with time zone NOT NULL,
	"vest_end" timestamp with time zone NOT NULL,
	"tx_hash" text,
	"posted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pool_epochs_status" CHECK ("pool_epochs"."status" in ('draft', 'posted', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "wallet_challenges" (
	"nonce" text PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"message" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "testers" ADD COLUMN "wallet_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pool_allocations" ADD CONSTRAINT "pool_allocations_epoch_row_id_pool_epochs_id_fk" FOREIGN KEY ("epoch_row_id") REFERENCES "public"."pool_epochs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "chain_orders_order_uq" ON "chain_orders" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chain_orders_tx_uq" ON "chain_orders" USING btree ("tx_hash");--> statement-breakpoint
CREATE INDEX "chain_orders_account_idx" ON "chain_orders" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "chain_orders_status_idx" ON "chain_orders" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "pool_allocations_wallet_uq" ON "pool_allocations" USING btree ("epoch_row_id","wallet");--> statement-breakpoint
CREATE UNIQUE INDEX "pool_allocations_account_uq" ON "pool_allocations" USING btree ("epoch_row_id","account_id");--> statement-breakpoint
CREATE INDEX "pool_allocations_wallet_idx" ON "pool_allocations" USING btree ("wallet");--> statement-breakpoint
CREATE UNIQUE INDEX "pool_epochs_uq" ON "pool_epochs" USING btree ("chain_id","pool_address","epoch_id");--> statement-breakpoint
CREATE INDEX "wallet_challenges_account_idx" ON "wallet_challenges" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "testers_wallet_verified_uq" ON "testers" USING btree (lower("wallet_address")) WHERE "testers"."wallet_verified_at" is not null;