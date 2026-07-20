-- 021_monotonic_delivery_status.sql
-- Provider callbacks can be duplicated or arrive out of order. Preserve every
-- raw event, but advance the denormalized messages.delivery_status snapshot
-- atomically so a late queued/sent callback cannot overwrite a later or
-- terminal outcome.

UPDATE public.messages
SET
  delivery_status = 'pending',
  updated_at = now()
WHERE delivery_status IS NULL;

ALTER TABLE public.messages
  ALTER COLUMN delivery_status SET NOT NULL;

CREATE OR REPLACE FUNCTION public.advance_message_delivery_status(
  p_message_id uuid,
  p_delivery_status text
)
RETURNS SETOF public.messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  effective_message public.messages%ROWTYPE;
BEGIN
  IF p_delivery_status IS NULL OR p_delivery_status NOT IN (
    'pending', 'queued', 'sent', 'delivered', 'failed', 'bounced'
  ) THEN
    RAISE EXCEPTION 'invalid delivery status %', p_delivery_status
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- pending -> queued -> sent is the ordered nonterminal path. Any of those
  -- states may advance directly to a terminal result when providers omit
  -- intermediate callbacks. delivered/failed/bounced are terminal: the first
  -- terminal callback wins and later contradictory or stale callbacks remain
  -- in the immutable event table without rewriting the message snapshot.
  UPDATE public.messages AS message
  SET
    delivery_status = p_delivery_status,
    updated_at = now()
  WHERE message.id = p_message_id
    AND (
      (
        message.delivery_status = 'pending'
        AND p_delivery_status IN ('queued', 'sent', 'delivered', 'failed', 'bounced')
      )
      OR (
        message.delivery_status = 'queued'
        AND p_delivery_status IN ('sent', 'delivered', 'failed', 'bounced')
      )
      OR (
        message.delivery_status = 'sent'
        AND p_delivery_status IN ('delivered', 'failed', 'bounced')
      )
    )
  RETURNING message.* INTO effective_message;

  IF effective_message.id IS NULL THEN
    SELECT message.*
    INTO effective_message
    FROM public.messages AS message
    WHERE message.id = p_message_id;
  END IF;

  IF effective_message.id IS NOT NULL THEN
    RETURN NEXT effective_message;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.advance_message_delivery_status(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.advance_message_delivery_status(uuid, text)
  TO project_admin;
