CREATE TABLE "order_tracking" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order_tracking" ADD CONSTRAINT "order_tracking_order_id_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "order_tracking_token_unique" ON "order_tracking" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "order_tracking_order_idx" ON "order_tracking" USING btree ("order_id");