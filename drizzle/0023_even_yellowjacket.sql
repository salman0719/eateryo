CREATE TABLE "account_access_state" (
	"user_id" text PRIMARY KEY NOT NULL,
	"password_set_at" timestamp,
	"reset_required" boolean DEFAULT false NOT NULL,
	"reset_sent_at" timestamp,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account_access_state" ADD CONSTRAINT "account_access_state_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;