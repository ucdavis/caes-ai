CREATE TYPE "public"."reasoning_effort" AS ENUM('none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max');--> statement-breakpoint
CREATE TABLE "application_api_keys" (
	"key_id" varchar(16) PRIMARY KEY NOT NULL,
	"application_id" varchar(64) NOT NULL,
	"label" varchar(80) NOT NULL,
	"key_hash" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "application_api_keys_id_format" CHECK ("application_api_keys"."key_id" ~ '^[a-f0-9]{16}$')
);
--> statement-breakpoint
CREATE TABLE "applications" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"display_name" varchar(120) NOT NULL,
	"tool_callback_url" text NOT NULL,
	"allowed_origins" text[] NOT NULL,
	"allowed_models" text[] NOT NULL,
	"maximum_reasoning_effort" "reasoning_effort" NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "applications_id_format" CHECK ("applications"."id" ~ '^[a-z][a-z0-9-]{0,63}$'),
	CONSTRAINT "applications_allowed_origins_not_empty" CHECK (cardinality("applications"."allowed_origins") > 0),
	CONSTRAINT "applications_allowed_models_not_empty" CHECK (cardinality("applications"."allowed_models") > 0)
);
--> statement-breakpoint
ALTER TABLE "application_api_keys" ADD CONSTRAINT "application_api_keys_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "application_api_keys_hash_uidx" ON "application_api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "application_api_keys_application_idx" ON "application_api_keys" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "applications_enabled_idx" ON "applications" USING btree ("enabled");
