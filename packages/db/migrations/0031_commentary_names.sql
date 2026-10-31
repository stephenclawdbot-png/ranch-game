CREATE TABLE "commentary_names" (
	"name_key" text NOT NULL,
	"caster" text NOT NULL,
	"name" text NOT NULL,
	"recipe" integer NOT NULL,
	"calm" "bytea" NOT NULL,
	"building" "bytea" NOT NULL,
	"climax" "bytea" NOT NULL,
	"bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commentary_names_name_key_caster_pk" PRIMARY KEY("name_key","caster"),
	CONSTRAINT "commentary_names_bytes" CHECK ("commentary_names"."bytes" > 0 and "commentary_names"."bytes" <= 98304)
);
