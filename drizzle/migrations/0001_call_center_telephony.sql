-- Operator PBX extension
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS extension text;
CREATE UNIQUE INDEX IF NOT EXISTS profiles_extension_unique ON public.profiles (extension) WHERE extension IS NOT NULL;

-- Georgian phone normalization: digits only, drop leading 995 or 0, last 9 digits
CREATE OR REPLACE FUNCTION public.normalize_ge_phone(_phone text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE d text;
BEGIN
  IF _phone IS NULL THEN RETURN NULL; END IF;
  d := regexp_replace(_phone, '\D', '', 'g');
  IF d LIKE '995%' THEN
    d := substr(d, 4);
  ELSIF d LIKE '0%' THEN
    d := substr(d, 2);
  END IF;
  IF length(d) < 9 THEN RETURN NULL; END IF;
  RETURN right(d, 9);
END;
$$;

CREATE INDEX IF NOT EXISTS clients_cabin_phone_norm_idx ON public.clients (public.normalize_ge_phone(cabin_phone));
CREATE INDEX IF NOT EXISTS clients_contact_phone_2_norm_idx ON public.clients (public.normalize_ge_phone(contact_phone_2));
CREATE INDEX IF NOT EXISTS objects_client_phone_norm_idx ON public.objects (public.normalize_ge_phone(client_phone));

-- Caller matching (server-only)
CREATE OR REPLACE FUNCTION public.match_caller(_phone text)
RETURNS TABLE (client_id uuid, object_id uuid, is_cabin boolean)
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE n text := public.normalize_ge_phone(_phone);
DECLARE c_id uuid;
DECLARE o_id uuid;
DECLARE cnt int;
BEGIN
  IF n IS NULL THEN RETURN; END IF;

  SELECT c.id INTO c_id FROM public.clients c
   WHERE public.normalize_ge_phone(c.cabin_phone) = n
   ORDER BY c.is_active DESC, c.created_at LIMIT 1;
  IF c_id IS NOT NULL THEN
    SELECT count(*), min(o.id::text)::uuid INTO cnt, o_id FROM public.objects o WHERE o.client_id = c_id;
    RETURN QUERY SELECT c_id, CASE WHEN cnt = 1 THEN o_id ELSE NULL END, true;
    RETURN;
  END IF;

  SELECT c.id INTO c_id FROM public.clients c
   WHERE public.normalize_ge_phone(c.contact_phone_2) = n
   ORDER BY c.is_active DESC, c.created_at LIMIT 1;
  IF c_id IS NOT NULL THEN
    SELECT count(*), min(o.id::text)::uuid INTO cnt, o_id FROM public.objects o WHERE o.client_id = c_id;
    RETURN QUERY SELECT c_id, CASE WHEN cnt = 1 THEN o_id ELSE NULL END, false;
    RETURN;
  END IF;

  SELECT o.id, o.client_id INTO o_id, c_id FROM public.objects o
   WHERE public.normalize_ge_phone(o.client_phone) = n
   ORDER BY o.created_at LIMIT 1;
  IF o_id IS NOT NULL THEN
    RETURN QUERY SELECT c_id, o_id, false;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.match_caller(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_caller(text) TO service_role;

-- Call logs
CREATE TABLE public.call_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_call_id text NOT NULL UNIQUE,
  direction text CHECK (direction IN ('inbound','outbound','internal')),
  caller_number text,
  caller_number_norm text,
  called_number text,
  queue_name text,
  agent_extension text,
  agent_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'ringing' CHECK (status IN ('ringing','answered','missed','abandoned','voicemail','test')),
  started_at timestamptz,
  answered_at timestamptz,
  ended_at timestamptz,
  wait_seconds integer,
  talk_seconds integer,
  recording_url text,
  matched_client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  matched_object_id uuid REFERENCES public.objects(id) ON DELETE SET NULL,
  is_cabin_call boolean NOT NULL DEFAULT false,
  service_call_id uuid REFERENCES public.service_calls(id) ON DELETE SET NULL,
  incoming_call_id uuid REFERENCES public.incoming_calls(id) ON DELETE SET NULL,
  callback_status text NOT NULL DEFAULT 'none' CHECK (callback_status IN ('none','pending','done','not_needed')),
  callback_by uuid,
  callback_at timestamptz,
  notes text,
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX call_logs_started_at_idx ON public.call_logs (started_at DESC);
CREATE INDEX call_logs_caller_number_norm_idx ON public.call_logs (caller_number_norm);
CREATE INDEX call_logs_status_idx ON public.call_logs (status);
CREATE INDEX call_logs_agent_profile_id_idx ON public.call_logs (agent_profile_id);
CREATE INDEX call_logs_callback_status_idx ON public.call_logs (callback_status);

CREATE OR REPLACE FUNCTION public.call_logs_before_write()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.caller_number_norm := public.normalize_ge_phone(NEW.caller_number);
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_call_logs_before_write BEFORE INSERT OR UPDATE ON public.call_logs
FOR EACH ROW EXECUTE FUNCTION public.call_logs_before_write();

GRANT SELECT ON public.call_logs TO authenticated;
GRANT UPDATE (notes, callback_status, callback_by, callback_at, service_call_id) ON public.call_logs TO authenticated;
GRANT ALL ON public.call_logs TO service_role;
ALTER TABLE public.call_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read call_logs" ON public.call_logs FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));
CREATE POLICY "staff update call_logs" ON public.call_logs FOR UPDATE TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

ALTER PUBLICATION supabase_realtime ADD TABLE public.call_logs;

-- Incoming calls link
ALTER TABLE public.incoming_calls ADD COLUMN IF NOT EXISTS is_cabin_call boolean NOT NULL DEFAULT false;
ALTER TABLE public.incoming_calls ADD COLUMN IF NOT EXISTS call_log_id uuid REFERENCES public.call_logs(id) ON DELETE SET NULL;

-- Telephony settings (single row)
CREATE TABLE public.telephony_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  webhook_token text NOT NULL DEFAULT encode(extensions.gen_random_bytes(20), 'hex'),
  answer_sla_seconds integer NOT NULL DEFAULT 20 CHECK (answer_sla_seconds BETWEEN 1 AND 600),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.telephony_settings TO authenticated;
GRANT UPDATE (answer_sla_seconds, updated_at) ON public.telephony_settings TO authenticated;
GRANT ALL ON public.telephony_settings TO service_role;
ALTER TABLE public.telephony_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read telephony_settings" ON public.telephony_settings FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));
CREATE POLICY "staff update telephony_settings" ON public.telephony_settings FOR UPDATE TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

INSERT INTO public.telephony_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Token rotation (staff only)
CREATE OR REPLACE FUNCTION public.regenerate_telephony_token()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t text;
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  t := encode(extensions.gen_random_bytes(20), 'hex');
  UPDATE public.telephony_settings SET webhook_token = t, updated_at = now() WHERE id = 1;
  RETURN t;
END;
$$;
REVOKE ALL ON FUNCTION public.regenerate_telephony_token() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.regenerate_telephony_token() TO authenticated;