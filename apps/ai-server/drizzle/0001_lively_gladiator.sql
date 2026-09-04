CREATE TABLE "assistant_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"application_id" varchar(64) NOT NULL,
	"client_run_id" varchar(256) NOT NULL,
	"thread_id" varchar(256) NOT NULL,
	"provider" varchar(64) NOT NULL,
	"transport" varchar(64) NOT NULL,
	"model" varchar(128) NOT NULL,
	"reasoning_effort" "reasoning_effort" NOT NULL,
	"outcome" varchar(64),
	"error_code" varchar(64),
	"duration_ms" integer,
	"input_tokens" integer,
	"output_tokens" integer,
	"total_tokens" integer,
	"reasoning_tokens" integer,
	"cached_input_tokens" integer,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "assistant_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"application_id" varchar(64) NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"user_reference_hash" varchar(64) NOT NULL,
	"context_token" text NOT NULL,
	"instructions" text NOT NULL,
	"application_snapshot" jsonb NOT NULL,
	"tool_manifest" jsonb NOT NULL,
	"tool_manifest_hash" varchar(64) NOT NULL,
	"model_policy" jsonb NOT NULL,
	"allow_per_turn_override" boolean NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assistant_tool_calls" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"application_id" varchar(64) NOT NULL,
	"run_id" varchar(256) NOT NULL,
	"tool_call_id" varchar(256) NOT NULL,
	"tool_name" varchar(64) NOT NULL,
	"risk" varchar(16) NOT NULL,
	"outcome" varchar(32) NOT NULL,
	"error_code" varchar(64),
	"duration_ms" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assistant_runs" ADD CONSTRAINT "assistant_runs_session_id_assistant_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."assistant_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_runs" ADD CONSTRAINT "assistant_runs_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_sessions" ADD CONSTRAINT "assistant_sessions_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_tool_calls" ADD CONSTRAINT "assistant_tool_calls_session_id_assistant_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."assistant_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_tool_calls" ADD CONSTRAINT "assistant_tool_calls_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assistant_runs_session_idx" ON "assistant_runs" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "assistant_runs_application_started_idx" ON "assistant_runs" USING btree ("application_id","started_at");--> statement-breakpoint
CREATE INDEX "assistant_sessions_application_idx" ON "assistant_sessions" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "assistant_sessions_expires_idx" ON "assistant_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "assistant_tool_calls_session_idx" ON "assistant_tool_calls" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "assistant_tool_calls_application_started_idx" ON "assistant_tool_calls" USING btree ("application_id","started_at");