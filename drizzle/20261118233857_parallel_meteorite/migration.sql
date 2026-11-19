CREATE TABLE "admin_audit" (
	"id" text PRIMARY KEY,
	"channel" text NOT NULL,
	"user_id" text NOT NULL,
	"action" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channel_state" (
	"channel" text PRIMARY KEY,
	"broadcaster_id" text NOT NULL,
	"data" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_deliveries" (
	"channel" text,
	"event_id" text,
	"consumer" text,
	"completed_at" timestamp with time zone,
	CONSTRAINT "event_deliveries_pkey" PRIMARY KEY("channel","event_id","consumer")
);
--> statement-breakpoint
CREATE TABLE "event_inbox" (
	"channel" text,
	"id" text,
	"data" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_inbox_pkey" PRIMARY KEY("channel","id")
);
--> statement-breakpoint
CREATE TABLE "oauth_connections" (
	"channel" text,
	"purpose" text,
	"user_id" text,
	"encrypted" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_connections_pkey" PRIMARY KEY("channel","purpose","user_id")
);
--> statement-breakpoint
CREATE TABLE "oauth_states" (
	"id" text PRIMARY KEY,
	"channel" text NOT NULL,
	"purpose" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY,
	"channel" text NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"csrf" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "pending_deliveries" ON "event_deliveries" ("channel","completed_at");