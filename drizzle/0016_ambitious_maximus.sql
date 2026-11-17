CREATE TABLE "order_line_option" (
	"id" text PRIMARY KEY NOT NULL,
	"order_line_id" text NOT NULL,
	"group_name" text NOT NULL,
	"choice_name" text NOT NULL,
	"price_delta_cents" integer
);
--> statement-breakpoint
ALTER TABLE "order_line_option" ADD CONSTRAINT "order_line_option_order_line_id_order_line_id_fk" FOREIGN KEY ("order_line_id") REFERENCES "public"."order_line"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_line_option_line_idx" ON "order_line_option" USING btree ("order_line_id");