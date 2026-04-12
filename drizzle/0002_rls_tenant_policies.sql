ALTER TABLE "organizations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "organization_members" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "invitations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "organizations_select_policy" ON "organizations"
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM organization_members om
    WHERE om.organization_id = organizations.id
      AND om.user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
  )
);
--> statement-breakpoint
CREATE POLICY "organizations_insert_policy" ON "organizations"
FOR INSERT
WITH CHECK (
  created_by_user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
);
--> statement-breakpoint
CREATE POLICY "organization_members_select_policy" ON "organization_members"
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM organization_members om
    WHERE om.organization_id = organization_members.organization_id
      AND om.user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
  )
);
--> statement-breakpoint
CREATE POLICY "organization_members_insert_policy" ON "organization_members"
FOR INSERT
WITH CHECK (
  user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
  AND organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid
);
--> statement-breakpoint
CREATE POLICY "invitations_select_policy" ON "invitations"
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM organization_members om
    WHERE om.organization_id = invitations.organization_id
      AND om.user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
  )
);
--> statement-breakpoint
CREATE POLICY "invitations_insert_policy" ON "invitations"
FOR INSERT
WITH CHECK (
  invited_by_user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
  AND organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid
);
