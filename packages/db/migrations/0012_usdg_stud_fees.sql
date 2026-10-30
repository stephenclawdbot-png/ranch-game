ALTER TYPE "public"."horse_lock" ADD VALUE 'stud';--> statement-breakpoint
ALTER TABLE "usdg_orders" DROP CONSTRAINT "usdg_orders_kind";--> statement-breakpoint
ALTER TABLE "horses" ADD COLUMN "stud_fee_usdg" bigint;--> statement-breakpoint
ALTER TABLE "usdg_orders" ADD COLUMN "mare_id" uuid;--> statement-breakpoint
ALTER TABLE "usdg_orders" ADD COLUMN "mare_ref" text;--> statement-breakpoint
ALTER TABLE "usdg_orders" ADD COLUMN "credits_held" bigint;--> statement-breakpoint
ALTER TABLE "usdg_orders" ADD COLUMN "breeding_event_id" uuid;--> statement-breakpoint
CREATE INDEX "usdg_orders_horse_idx" ON "usdg_orders" USING btree ("horse_id","kind","status");--> statement-breakpoint
CREATE UNIQUE INDEX "usdg_orders_breeding_uq" ON "usdg_orders" USING btree ("breeding_event_id");--> statement-breakpoint
ALTER TABLE "horses" ADD CONSTRAINT "horses_stud_fee_usdg" CHECK ("horses"."stud_fee_usdg" is null or ("horses"."stud_fee_usdg" > 0 and "horses"."stud_fee" is null));--> statement-breakpoint
ALTER TABLE "usdg_orders" ADD CONSTRAINT "usdg_orders_stud" CHECK (("usdg_orders"."kind" = 'stud') = ("usdg_orders"."mare_id" is not null));--> statement-breakpoint
ALTER TABLE "usdg_orders" ADD CONSTRAINT "usdg_orders_kind" CHECK ("usdg_orders"."kind" in ('registration', 'sale', 'stud'));