DROP POLICY IF EXISTS "invitations_select_policy" ON "invitations";
--> statement-breakpoint
CREATE POLICY "invitations_select_policy" ON "invitations"
FOR SELECT
USING (
  public.is_organization_member(
    invitations.organization_id,
    NULLIF(current_setting('app.current_user_id', true), '')::uuid
  )
  OR (
    invitations.status = 'pending'
    AND lower(invitations.email) = lower(current_setting('app.current_user_email', true))
  )
);
--> statement-breakpoint
CREATE POLICY "invitations_update_policy" ON "invitations"
FOR UPDATE
USING (
  (
    public.is_organization_member(
      invitations.organization_id,
      NULLIF(current_setting('app.current_user_id', true), '')::uuid
    )
    AND EXISTS (
      SELECT 1
      FROM public.organization_members om
      WHERE om.organization_id = invitations.organization_id
        AND om.user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
        AND om.role = 'admin'
    )
  )
  OR (
    invitations.status = 'pending'
    AND lower(invitations.email) = lower(current_setting('app.current_user_email', true))
  )
)
WITH CHECK (
  (
    status = 'revoked'
    AND public.is_organization_member(
      invitations.organization_id,
      NULLIF(current_setting('app.current_user_id', true), '')::uuid
    )
  )
  OR (
    status = 'accepted'
    AND lower(invitations.email) = lower(current_setting('app.current_user_email', true))
  )
);
