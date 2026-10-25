ALTER TABLE "horses" ADD COLUMN "fatigue_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pregnancies" ADD COLUMN "coi" integer DEFAULT 0 NOT NULL;