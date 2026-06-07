-- 004_create_organization_onboarding_rpc.sql
-- Creates an atomic onboarding RPC for signup-created workspaces.

CREATE OR REPLACE FUNCTION create_organization_with_owner(
  org_name text,
  org_slug text DEFAULT NULL
)
RETURNS TABLE (
  organization_id uuid,
  member_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn_create_org$
DECLARE
  actor_user_id text;
  normalized_name text;
  base_slug text;
  candidate_slug text;
  suffix int := 1;
  created_org_id uuid;
  created_member_id uuid;
BEGIN
  actor_user_id := auth.uid()::text;

  IF actor_user_id IS NULL OR actor_user_id = '' THEN
    RAISE EXCEPTION 'Authentication required'
      USING ERRCODE = '28000';
  END IF;

  normalized_name := NULLIF(btrim(org_name), '');

  IF normalized_name IS NULL THEN
    RAISE EXCEPTION 'Organization name is required'
      USING ERRCODE = '22023';
  END IF;

  SELECT om.organization_id, om.id
  INTO created_org_id, created_member_id
  FROM organization_members om
  WHERE om.user_id = actor_user_id
  ORDER BY om.created_at ASC
  LIMIT 1;

  IF created_org_id IS NOT NULL THEN
    INSERT INTO ai_settings (organization_id)
    VALUES (created_org_id)
    ON CONFLICT (organization_id) DO NOTHING;

    RETURN QUERY SELECT created_org_id, created_member_id;
    RETURN;
  END IF;

  base_slug := lower(coalesce(NULLIF(btrim(org_slug), ''), normalized_name));
  base_slug := regexp_replace(base_slug, '[^a-z0-9]+', '-', 'g');
  base_slug := btrim(base_slug, '-');

  IF base_slug = '' THEN
    base_slug := 'workspace';
  END IF;

  candidate_slug := base_slug;

  LOOP
    BEGIN
      INSERT INTO organizations (name, slug)
      VALUES (normalized_name, candidate_slug)
      RETURNING id INTO created_org_id;

      EXIT;
    EXCEPTION WHEN unique_violation THEN
      suffix := suffix + 1;
      candidate_slug := base_slug || '-' || suffix::text;
    END;
  END LOOP;

  INSERT INTO organization_members (organization_id, user_id, role)
  VALUES (created_org_id, actor_user_id, 'owner')
  RETURNING id INTO created_member_id;

  INSERT INTO ai_settings (organization_id)
  VALUES (created_org_id)
  ON CONFLICT (organization_id) DO NOTHING;

  INSERT INTO audit_logs (
    organization_id,
    actor_id,
    actor_type,
    action,
    resource_type,
    resource_id
  )
  VALUES (
    created_org_id,
    actor_user_id,
    'user',
    'organization_created',
    'organization',
    created_org_id::text
  );

  RETURN QUERY SELECT created_org_id, created_member_id;
END;
$fn_create_org$;

GRANT EXECUTE ON FUNCTION create_organization_with_owner(text, text) TO authenticated;
