CREATE TABLE "top_pick_snapshots" (
	"token" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"include_extras" boolean NOT NULL,
	"filter" text NOT NULL,
	"bucket_started_at" timestamp with time zone NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "top_pick_snapshots_scope_bucket_unique" UNIQUE("user_id","include_extras","filter","bucket_started_at")
);
--> statement-breakpoint
ALTER TABLE "top_pick_snapshots" ADD CONSTRAINT "top_pick_snapshots_user_id_users_kitsu_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("kitsu_user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "top_pick_snapshots_expiry_idx" ON "top_pick_snapshots" USING btree ("expires_at");