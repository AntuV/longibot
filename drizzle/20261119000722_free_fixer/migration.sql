ALTER TABLE "event_deliveries" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "event_deliveries" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "event_deliveries" ADD COLUMN "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL;