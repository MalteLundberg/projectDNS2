CREATE TABLE "dns_zones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"provider" text DEFAULT 'powerdns' NOT NULL,
	"powerdns_zone_id" text NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dns_zones_organization_id_name_unique" UNIQUE("organization_id","name")
);
--> statement-breakpoint
ALTER TABLE "dns_zones" ADD CONSTRAINT "dns_zones_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "dns_zones" ADD CONSTRAINT "dns_zones_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "dns_zones_organization_id_idx" ON "dns_zones" USING btree ("organization_id");
--> statement-breakpoint
ALTER TABLE "dns_zones" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "dns_zones" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "dns_zones_select_policy" ON "dns_zones"
FOR SELECT
USING (
  public.is_organization_member(
    dns_zones.organization_id,
    NULLIF(current_setting('app.current_user_id', true), '')::uuid
  )
);
--> statement-breakpoint
CREATE POLICY "dns_zones_insert_policy" ON "dns_zones"
FOR INSERT
WITH CHECK (
  organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid
  AND created_by_user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
);
