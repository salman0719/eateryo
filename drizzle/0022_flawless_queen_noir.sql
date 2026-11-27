CREATE TABLE "account_suspension" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"reason" text NOT NULL,
	"note" text,
	"suspended_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"lifted_at" timestamp,
	"lifted_by" text,
	"lift_note" text
);
--> statement-breakpoint
CREATE TABLE "platform_event" (
	"id" text PRIMARY KEY NOT NULL,
	"action" text NOT NULL,
	"actor_user_id" text,
	"actor_email" text,
	"target_user_id" text,
	"target_email" text,
	"detail" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account_suspension" ADD CONSTRAINT "account_suspension_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_suspension" ADD CONSTRAINT "account_suspension_suspended_by_user_id_fk" FOREIGN KEY ("suspended_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_suspension" ADD CONSTRAINT "account_suspension_lifted_by_user_id_fk" FOREIGN KEY ("lifted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_event" ADD CONSTRAINT "platform_event_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_event" ADD CONSTRAINT "platform_event_target_user_id_user_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_suspension_open_unique" ON "account_suspension" USING btree ("user_id") WHERE "account_suspension"."lifted_at" is null;--> statement-breakpoint
CREATE INDEX "platform_event_action_created_idx" ON "platform_event" USING btree ("action","created_at");