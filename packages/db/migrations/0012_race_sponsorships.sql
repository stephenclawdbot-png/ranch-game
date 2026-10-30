CREATE TABLE "race_sponsorships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slot_index" integer NOT NULL,
	"post_time" timestamp with time zone NOT NULL,
	"account_id" uuid NOT NULL,
	"stable_id" uuid NOT NULL,
	"stable_name" text NOT NULL,
	"silks" jsonb,
	"price" bigint NOT NULL,
	"idempotency_key" text NOT NULL,
	"ledger_transaction_id" uuid,
	"race_id" uuid,
	"refunded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "race_sponsorships_price" CHECK ("race_sponsorships"."price" > 0)
);
--> statement-breakpoint
ALTER TABLE "race_sponsorships" ADD CONSTRAINT "race_sponsorships_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "race_sponsorships" ADD CONSTRAINT "race_sponsorships_stable_id_stables_id_fk" FOREIGN KEY ("stable_id") REFERENCES "public"."stables"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "race_sponsorships" ADD CONSTRAINT "race_sponsorships_ledger_transaction_id_ledger_transactions_id_fk" FOREIGN KEY ("ledger_transaction_id") REFERENCES "public"."ledger_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "race_sponsorships" ADD CONSTRAINT "race_sponsorships_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "race_sponsorships_slot_uq" ON "race_sponsorships" USING btree ("slot_index");--> statement-breakpoint
CREATE UNIQUE INDEX "race_sponsorships_key_uq" ON "race_sponsorships" USING btree ("account_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "race_sponsorships_stable_idx" ON "race_sponsorships" USING btree ("stable_id","post_time");--> statement-breakpoint
CREATE INDEX "race_sponsorships_race_idx" ON "race_sponsorships" USING btree ("race_id");