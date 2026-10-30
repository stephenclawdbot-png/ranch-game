CREATE TABLE "stable_photos" (
	"stable_id" uuid PRIMARY KEY NOT NULL,
	"image" "bytea" NOT NULL,
	"hash" text NOT NULL,
	"bytes" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"uploads_day" text NOT NULL,
	"uploads_today" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stables" ADD COLUMN "photo_hash" text;--> statement-breakpoint
ALTER TABLE "stable_photos" ADD CONSTRAINT "stable_photos_stable_id_stables_id_fk" FOREIGN KEY ("stable_id") REFERENCES "public"."stables"("id") ON DELETE no action ON UPDATE no action;