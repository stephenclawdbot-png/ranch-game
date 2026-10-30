CREATE TABLE "horse_lease_listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"horse_id" uuid NOT NULL,
	"owner_stable_id" uuid NOT NULL,
	"term_days" integer NOT NULL,
	"owner_share_pct" integer NOT NULL,
	"fee" bigint DEFAULT 0 NOT NULL,
	"allow_all_out" boolean DEFAULT false NOT NULL,
	"max_live_starts_per_week" integer DEFAULT 4 NOT NULL,
	"min_lessee_rating" integer,
	"status" "listing_status" DEFAULT 'active' NOT NULL,
	"lease_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "horse_lease_listings_terms" CHECK ("horse_lease_listings"."term_days" between 1 and 60 and "horse_lease_listings"."owner_share_pct" between 0 and 100 and "horse_lease_listings"."fee" >= 0 and "horse_lease_listings"."max_live_starts_per_week" between 1 and 21 and ("horse_lease_listings"."min_lessee_rating" is null or "horse_lease_listings"."min_lessee_rating" between 1 and 5)),
	CONSTRAINT "horse_lease_listings_expiry" CHECK ("horse_lease_listings"."expires_at" > "horse_lease_listings"."created_at")
);
--> statement-breakpoint
CREATE TABLE "horse_leases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid NOT NULL,
	"horse_id" uuid NOT NULL,
	"owner_stable_id" uuid NOT NULL,
	"lessee_stable_id" uuid NOT NULL,
	"term_days" integer NOT NULL,
	"owner_share_pct" integer NOT NULL,
	"fee" bigint DEFAULT 0 NOT NULL,
	"fee_cut" bigint DEFAULT 0 NOT NULL,
	"allow_all_out" boolean DEFAULT false NOT NULL,
	"max_live_starts_per_week" integer DEFAULT 4 NOT NULL,
	"start_condition" jsonb,
	"end_condition" jsonb,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"end_reason" text,
	"end_requested_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"races" integer DEFAULT 0 NOT NULL,
	"owner_earned" bigint DEFAULT 0 NOT NULL,
	"lessee_earned" bigint DEFAULT 0 NOT NULL,
	"entries" integer DEFAULT 0 NOT NULL,
	"fatigue_at_entry_sum" integer DEFAULT 0 NOT NULL,
	"injuries" integer DEFAULT 0 NOT NULL,
	"owner_rating" integer,
	"rated_at" timestamp with time zone,
	"fee_transaction_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "horse_leases_parties" CHECK ("horse_leases"."owner_stable_id" <> "horse_leases"."lessee_stable_id"),
	CONSTRAINT "horse_leases_status" CHECK ("horse_leases"."status" in ('active', 'ended')),
	CONSTRAINT "horse_leases_ended" CHECK (("horse_leases"."status" = 'ended') = ("horse_leases"."ended_at" is not null)),
	CONSTRAINT "horse_leases_range" CHECK ("horse_leases"."ends_at" > "horse_leases"."starts_at"),
	CONSTRAINT "horse_leases_rating" CHECK ("horse_leases"."owner_rating" is null or ("horse_leases"."owner_rating" between 1 and 5 and "horse_leases"."status" = 'ended')),
	CONSTRAINT "horse_leases_record" CHECK ("horse_leases"."entries" >= 0 and "horse_leases"."fatigue_at_entry_sum" >= 0 and "horse_leases"."injuries" >= 0),
	CONSTRAINT "horse_leases_money" CHECK ("horse_leases"."fee" >= 0 and "horse_leases"."fee_cut" >= 0 and "horse_leases"."fee_cut" <= "horse_leases"."fee" and "horse_leases"."owner_earned" >= 0 and "horse_leases"."lessee_earned" >= 0 and "horse_leases"."races" >= 0)
);
--> statement-breakpoint
ALTER TABLE "horses" ADD COLUMN "lessee_stable_id" uuid;--> statement-breakpoint
ALTER TABLE "horse_lease_listings" ADD CONSTRAINT "horse_lease_listings_horse_id_horses_id_fk" FOREIGN KEY ("horse_id") REFERENCES "public"."horses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "horse_lease_listings" ADD CONSTRAINT "horse_lease_listings_owner_stable_id_stables_id_fk" FOREIGN KEY ("owner_stable_id") REFERENCES "public"."stables"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "horse_leases" ADD CONSTRAINT "horse_leases_listing_id_horse_lease_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."horse_lease_listings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "horse_leases" ADD CONSTRAINT "horse_leases_horse_id_horses_id_fk" FOREIGN KEY ("horse_id") REFERENCES "public"."horses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "horse_leases" ADD CONSTRAINT "horse_leases_owner_stable_id_stables_id_fk" FOREIGN KEY ("owner_stable_id") REFERENCES "public"."stables"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "horse_leases" ADD CONSTRAINT "horse_leases_lessee_stable_id_stables_id_fk" FOREIGN KEY ("lessee_stable_id") REFERENCES "public"."stables"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "horse_leases" ADD CONSTRAINT "horse_leases_fee_transaction_id_ledger_transactions_id_fk" FOREIGN KEY ("fee_transaction_id") REFERENCES "public"."ledger_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "horse_lease_listings_horse_active_uq" ON "horse_lease_listings" USING btree ("horse_id") WHERE "horse_lease_listings"."status" = 'active';--> statement-breakpoint
CREATE INDEX "horse_lease_listings_status_idx" ON "horse_lease_listings" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "horse_lease_listings_owner_idx" ON "horse_lease_listings" USING btree ("owner_stable_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "horse_leases_listing_uq" ON "horse_leases" USING btree ("listing_id");--> statement-breakpoint
CREATE UNIQUE INDEX "horse_leases_horse_active_uq" ON "horse_leases" USING btree ("horse_id") WHERE "horse_leases"."status" = 'active';--> statement-breakpoint
CREATE INDEX "horse_leases_owner_idx" ON "horse_leases" USING btree ("owner_stable_id","status");--> statement-breakpoint
CREATE INDEX "horse_leases_lessee_idx" ON "horse_leases" USING btree ("lessee_stable_id","status");--> statement-breakpoint
CREATE INDEX "horse_leases_due_idx" ON "horse_leases" USING btree ("status","ends_at");--> statement-breakpoint
ALTER TABLE "horses" ADD CONSTRAINT "horses_lessee_stable_id_stables_id_fk" FOREIGN KEY ("lessee_stable_id") REFERENCES "public"."stables"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "horses_lessee_idx" ON "horses" USING btree ("lessee_stable_id");--> statement-breakpoint
ALTER TABLE "horses" ADD CONSTRAINT "horses_lessee_not_owner" CHECK ("horses"."lessee_stable_id" is null or "horses"."lessee_stable_id" is distinct from "horses"."owner_stable_id");