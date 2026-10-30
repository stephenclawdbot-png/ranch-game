CREATE TABLE "race_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"race_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"horse_id" uuid NOT NULL,
	"owner_stable_id" uuid NOT NULL,
	"claimant_stable_id" uuid NOT NULL,
	"price" bigint NOT NULL,
	"status" text DEFAULT 'lodged' NOT NULL,
	"fee" bigint DEFAULT 0 NOT NULL,
	"escrow_transaction_id" uuid NOT NULL,
	"close_transaction_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "race_claims_status" CHECK ("race_claims"."status" in ('lodged', 'drawn', 'lost', 'claimed', 'void', 'refunded')),
	CONSTRAINT "race_claims_price" CHECK ("race_claims"."price" > 0)
);
--> statement-breakpoint
ALTER TABLE "race_entries" ADD COLUMN "claim_price" bigint;--> statement-breakpoint
ALTER TABLE "race_claims" ADD CONSTRAINT "race_claims_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "race_claims" ADD CONSTRAINT "race_claims_entry_id_race_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."race_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "race_claims" ADD CONSTRAINT "race_claims_horse_id_horses_id_fk" FOREIGN KEY ("horse_id") REFERENCES "public"."horses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "race_claims" ADD CONSTRAINT "race_claims_owner_stable_id_stables_id_fk" FOREIGN KEY ("owner_stable_id") REFERENCES "public"."stables"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "race_claims" ADD CONSTRAINT "race_claims_claimant_stable_id_stables_id_fk" FOREIGN KEY ("claimant_stable_id") REFERENCES "public"."stables"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "race_claims" ADD CONSTRAINT "race_claims_escrow_transaction_id_ledger_transactions_id_fk" FOREIGN KEY ("escrow_transaction_id") REFERENCES "public"."ledger_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "race_claims" ADD CONSTRAINT "race_claims_close_transaction_id_ledger_transactions_id_fk" FOREIGN KEY ("close_transaction_id") REFERENCES "public"."ledger_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "race_claims_race_claimant_uq" ON "race_claims" USING btree ("race_id","claimant_stable_id");--> statement-breakpoint
CREATE INDEX "race_claims_horse_idx" ON "race_claims" USING btree ("horse_id","status");--> statement-breakpoint
CREATE INDEX "race_claims_claimant_idx" ON "race_claims" USING btree ("claimant_stable_id","status");