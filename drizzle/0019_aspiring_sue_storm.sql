CREATE TABLE "restaurant_payment_account" (
	"id" text PRIMARY KEY NOT NULL,
	"restaurant_id" text NOT NULL,
	"provider" text NOT NULL,
	"mode" text NOT NULL,
	"livemode" boolean DEFAULT false NOT NULL,
	"external_account_id" text NOT NULL,
	"status" text NOT NULL,
	"charges_enabled" boolean DEFAULT false NOT NULL,
	"payouts_enabled" boolean DEFAULT false NOT NULL,
	"details_submitted" boolean DEFAULT false NOT NULL,
	"country" text,
	"default_currency" text,
	"requirement_codes" text[] DEFAULT '{}' NOT NULL,
	"connected_at" timestamp,
	"status_checked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stripe_event" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"account_id" text,
	"order_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "payment_status" text NOT NULL;--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "payment_provider" text;--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "payment_reference" text;--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "payment_intent_id" text;--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "payment_method_label" text;--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "paid_at" timestamp;--> statement-breakpoint
ALTER TABLE "restaurant_payment_account" ADD CONSTRAINT "restaurant_payment_account_restaurant_id_restaurant_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stripe_event" ADD CONSTRAINT "stripe_event_order_id_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "restaurant_payment_account_restaurant_provider_unique" ON "restaurant_payment_account" USING btree ("restaurant_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "restaurant_payment_account_external_account_unique" ON "restaurant_payment_account" USING btree ("external_account_id");