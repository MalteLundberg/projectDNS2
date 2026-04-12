DROP POLICY IF EXISTS "organizations_select_policy" ON "organizations";
--> statement-breakpoint
DROP POLICY IF EXISTS "organization_members_select_policy" ON "organization_members";
--> statement-breakpoint
DROP POLICY IF EXISTS "invitations_select_policy" ON "invitations";
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.is_organization_member(check_organization_id uuid, check_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members om
    WHERE om.organization_id = check_organization_id
      AND om.user_id = check_user_id
  );
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.is_organization_member(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.is_organization_member(uuid, uuid) TO PUBLIC;
--> statement-breakpoint
CREATE POLICY "organizations_select_policy" ON "organizations"
FOR SELECT
USING (
  public.is_organization_member(
    organizations.id,
    NULLIF(current_setting('app.current_user_id', true), '')::uuid
  )
);
--> statement-breakpoint
CREATE POLICY "organization_members_select_policy" ON "organization_members"
FOR SELECT
USING (
  public.is_organization_member(
    organization_members.organization_id,
    NULLIF(current_setting('app.current_user_id', true), '')::uuid
  )
);
--> statement-breakpoint
CREATE POLICY "invitations_select_policy" ON "invitations"
FOR SELECT
USING (
  public.is_organization_member(
    invitations.organization_id,
    NULLIF(current_setting('app.current_user_id', true), '')::uuid
  )
);
