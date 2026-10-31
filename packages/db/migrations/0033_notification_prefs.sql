CREATE TABLE "notification_prefs" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"disabled" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inbox_items" ADD COLUMN "seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notification_prefs" ADD CONSTRAINT "notification_prefs_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "horses_injured_until_idx" ON "horses" USING btree ("injured_until") WHERE "horses"."injured_until" is not null;