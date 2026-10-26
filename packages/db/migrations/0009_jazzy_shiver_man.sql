ALTER TABLE "wallet_challenges" ALTER COLUMN "account_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "wallet_challenges" ADD COLUMN "purpose" text DEFAULT 'link' NOT NULL;