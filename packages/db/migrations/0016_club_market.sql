CREATE TABLE "club_market_days" (
	"day" text PRIMARY KEY NOT NULL,
	"listed" integer DEFAULT 0 NOT NULL,
	"offered" integer DEFAULT 0 NOT NULL,
	"withdrawn" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "horse_lease_listings" ALTER COLUMN "owner_stable_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "horse_leases" ALTER COLUMN "owner_stable_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "market_listings" ALTER COLUMN "seller_stable_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "trades" ALTER COLUMN "seller_stable_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "horse_lease_listings" ADD COLUMN "club" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "horse_leases" ADD COLUMN "club" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "market_listings" ADD COLUMN "club" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "club" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "horse_lease_listings" ADD CONSTRAINT "horse_lease_listings_club" CHECK ("horse_lease_listings"."club" = ("horse_lease_listings"."owner_stable_id" is null));--> statement-breakpoint
ALTER TABLE "horse_leases" ADD CONSTRAINT "horse_leases_club" CHECK ("horse_leases"."club" = ("horse_leases"."owner_stable_id" is null));--> statement-breakpoint
ALTER TABLE "market_listings" ADD CONSTRAINT "market_listings_club" CHECK ("market_listings"."club" = ("market_listings"."seller_stable_id" is null));