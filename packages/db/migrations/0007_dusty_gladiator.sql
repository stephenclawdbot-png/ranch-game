CREATE TYPE "public"."daily_goal" AS ENUM('race', 'care', 'cup');--> statement-breakpoint
CREATE TABLE "daily_goals" (
	"account_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"goal" "daily_goal" NOT NULL,
	"completed_at" timestamp with time zone NOT NULL,
	"ledger_tx_id" uuid NOT NULL,
	CONSTRAINT "daily_goals_account_id_local_date_goal_pk" PRIMARY KEY("account_id","local_date","goal")
);
--> statement-breakpoint
ALTER TABLE "daily_goals" ADD CONSTRAINT "daily_goals_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_goals" ADD CONSTRAINT "daily_goals_ledger_tx_id_ledger_transactions_id_fk" FOREIGN KEY ("ledger_tx_id") REFERENCES "public"."ledger_transactions"("id") ON DELETE no action ON UPDATE no action;