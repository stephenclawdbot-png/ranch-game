CREATE TABLE "feature_unlocks" (
	"account_id" uuid NOT NULL,
	"feature" text NOT NULL,
	"reason" text NOT NULL,
	"unlocked_at" timestamp with time zone NOT NULL,
	CONSTRAINT "feature_unlocks_account_id_feature_pk" PRIMARY KEY("account_id","feature")
);
--> statement-breakpoint
CREATE TABLE "onboarding_states" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"guided" boolean DEFAULT false NOT NULL,
	"plain_language" boolean DEFAULT false NOT NULL,
	"mentor_done_at" timestamp with time zone,
	"coach_seen" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"steps_done_at" timestamp with time zone,
	"last_visit_at" timestamp with time zone,
	"welcome_back_from" timestamp with time zone,
	"welcome_back_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stable_steps" (
	"account_id" uuid NOT NULL,
	"step" text NOT NULL,
	"completed_at" timestamp with time zone NOT NULL,
	"ledger_tx_id" uuid NOT NULL,
	CONSTRAINT "stable_steps_account_id_step_pk" PRIMARY KEY("account_id","step")
);
--> statement-breakpoint
ALTER TABLE "feature_unlocks" ADD CONSTRAINT "feature_unlocks_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_states" ADD CONSTRAINT "onboarding_states_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stable_steps" ADD CONSTRAINT "stable_steps_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stable_steps" ADD CONSTRAINT "stable_steps_ledger_tx_id_ledger_transactions_id_fk" FOREIGN KEY ("ledger_tx_id") REFERENCES "public"."ledger_transactions"("id") ON DELETE no action ON UPDATE no action;