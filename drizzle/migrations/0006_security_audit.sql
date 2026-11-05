-- 0006 — უსაფრთხოების რევიზია (2026-11-05)
-- ავტორი: Giorgi Turmanidze "GT"
--
-- 1. გათიშული (is_active = false) თანამშრომელი კარგავს ყველა წვდომას.
-- 2. profiles / user_roles — მხოლოდ თანამშრომლებისთვის (არა „მოლოდინში“ მყოფი ანგარიშებისთვის).
-- 3. საკუთარი პროფილით is_active / extension / email-ის შეცვლა — მხოლოდ მენეჯერს.
-- 4. call_notes / call_status_history — გაყალბების დაბლოკვა, ტექნიკოსს მხოლოდ თავისი გამოძახებები.
-- 5. call_logs — თანამშრომელს მხოლოდ სამუშაო ველების შეცვლა (KPI-ს გაყალბება შეუძლებელია).
-- 6. telephony_settings — ტოკენი მხოლოდ მენეჯერს; პარამეტრების შეცვლა მხოლოდ მენეჯერს.
-- 7. ტექნიკოსს თავის გამოძახებაში მხოლოდ სტატუსისა და შედეგის შეცვლა შეუძლია.
-- 8. incoming_calls — მხოლოდ თანამშრომლებისთვის.

-- 1 ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles r
    JOIN public.profiles p ON p.id = r.user_id AND p.is_active
    WHERE r.user_id = _user_id AND r.role = _role)
$$;

CREATE OR REPLACE FUNCTION public.is_staff(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles r
    JOIN public.profiles p ON p.id = r.user_id AND p.is_active
    WHERE r.user_id = _user_id AND r.role IN ('dispatcher','manager'))
$$;

-- 2 ─────────────────────────────────────────────────────────────
DO $$ DECLARE p record; BEGIN
  FOR p IN SELECT policyname FROM pg_policies
           WHERE schemaname = 'public' AND tablename = 'profiles' AND cmd = 'SELECT' LOOP
    EXECUTE format('DROP POLICY %I ON public.profiles', p.policyname);
  END LOOP;
END $$;
CREATE POLICY "profiles read" ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.is_staff(auth.uid()) OR public.has_role(auth.uid(), 'technician'));

DO $$ DECLARE p record; BEGIN
  FOR p IN SELECT policyname FROM pg_policies
           WHERE schemaname = 'public' AND tablename = 'user_roles' AND cmd = 'SELECT' LOOP
    EXECUTE format('DROP POLICY %I ON public.user_roles', p.policyname);
  END LOOP;
END $$;
CREATE POLICY "user_roles read" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_staff(auth.uid()) OR public.has_role(auth.uid(), 'technician'));

-- 3 ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.profiles_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- service_role / სისტემური ტრიგერები (auth.uid() IS NULL) — თავისუფლად
  IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'manager') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.extension := NULL;
    RETURN NEW;
  END IF;
  IF NEW.is_active IS DISTINCT FROM OLD.is_active
     OR NEW.extension IS DISTINCT FROM OLD.extension
     OR NEW.email IS DISTINCT FROM OLD.email
     OR NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'ამ ველის შეცვლა მხოლოდ მენეჯერს შეუძლია' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_profiles_guard ON public.profiles;
CREATE TRIGGER trg_profiles_guard BEFORE INSERT OR UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.profiles_guard();

-- 4 ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.can_see_call(_call_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_staff(auth.uid())
      OR (public.has_role(auth.uid(), 'technician')
          AND EXISTS (SELECT 1 FROM public.service_calls c
                      WHERE c.id = _call_id AND c.assigned_to = auth.uid()))
$$;

DO $$ DECLARE p record; BEGIN
  FOR p IN SELECT tablename, policyname FROM pg_policies
           WHERE schemaname = 'public' AND tablename IN ('call_notes','call_status_history') LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, p.tablename);
  END LOOP;
END $$;
CREATE POLICY "notes read" ON public.call_notes FOR SELECT TO authenticated
  USING (public.can_see_call(call_id));
CREATE POLICY "notes insert" ON public.call_notes FOR INSERT TO authenticated
  WITH CHECK (author_id = auth.uid() AND public.can_see_call(call_id));
CREATE POLICY "notes delete" ON public.call_notes FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'manager'));
REVOKE UPDATE ON public.call_notes FROM authenticated, anon;

CREATE POLICY "history read" ON public.call_status_history FOR SELECT TO authenticated
  USING (public.can_see_call(call_id));
-- ისტორიას წერს მხოლოდ ტრიგერი
REVOKE INSERT, UPDATE, DELETE ON public.call_status_history FROM authenticated, anon;
CREATE OR REPLACE FUNCTION public.log_call_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.status <> OLD.status THEN
    INSERT INTO public.call_status_history (call_id, status, changed_by)
    VALUES (NEW.id, NEW.status, auth.uid());
  END IF;
  RETURN NEW;
END;
$$;

-- 5 ─────────────────────────────────────────────────────────────
REVOKE INSERT, UPDATE, DELETE ON public.call_logs FROM authenticated, anon;
GRANT UPDATE (notes, callback_status, callback_by, callback_at, service_call_id,
              matched_client_id, matched_object_id) ON public.call_logs TO authenticated;

-- 6 ─────────────────────────────────────────────────────────────
REVOKE ALL ON public.telephony_settings FROM authenticated, anon;
GRANT SELECT (id, answer_sla_seconds, main_number, pbx_wss_url, updated_at)
  ON public.telephony_settings TO authenticated;
GRANT UPDATE (answer_sla_seconds, main_number, pbx_wss_url, updated_at)
  ON public.telephony_settings TO authenticated;
DROP POLICY IF EXISTS "staff update telephony_settings" ON public.telephony_settings;
CREATE POLICY "manager update telephony_settings" ON public.telephony_settings FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'manager')) WITH CHECK (public.has_role(auth.uid(), 'manager'));

CREATE OR REPLACE FUNCTION public.get_telephony_token()
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'manager') THEN
    RAISE EXCEPTION 'მხოლოდ მენეჯერისთვის' USING ERRCODE = '42501';
  END IF;
  RETURN (SELECT webhook_token FROM public.telephony_settings WHERE id = 1);
END;
$$;
REVOKE ALL ON FUNCTION public.get_telephony_token() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_telephony_token() TO authenticated;

CREATE OR REPLACE FUNCTION public.regenerate_telephony_token()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'manager') THEN
    RAISE EXCEPTION 'მხოლოდ მენეჯერისთვის' USING ERRCODE = '42501';
  END IF;
  t := encode(extensions.gen_random_bytes(20), 'hex');
  UPDATE public.telephony_settings SET webhook_token = t, updated_at = now() WHERE id = 1;
  RETURN t;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_operator_contact(_profile_id uuid, _extension text, _phone text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ext text := NULLIF(btrim(_extension), '');
BEGIN
  IF NOT public.has_role(auth.uid(), 'manager') THEN
    RAISE EXCEPTION 'მხოლოდ მენეჯერისთვის' USING ERRCODE = '42501';
  END IF;
  IF ext IS NOT NULL AND ext !~ '^[1-9][0-9]{1,3}$' THEN
    RAISE EXCEPTION 'შიდა ნომერი: 2–4 ციფრი (არა 0-ით)' USING ERRCODE = '22023';
  END IF;
  UPDATE public.profiles
     SET extension = ext, phone = NULLIF(btrim(_phone), '')
   WHERE id = _profile_id;
END;
$$;

-- 7 ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.service_calls_tech_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE allowed text[] := ARRAY['status','resolution','responded_at','completed_at',
                                'closed_at','updated_at','sla_due_at'];
BEGIN
  IF auth.uid() IS NULL OR public.is_staff(auth.uid()) THEN
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - allowed) IS DISTINCT FROM (to_jsonb(OLD) - allowed) THEN
    RAISE EXCEPTION 'ტექნიკოსს მხოლოდ სტატუსისა და შედეგის შეცვლა შეუძლია' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_service_calls_tech_guard ON public.service_calls;
CREATE TRIGGER trg_service_calls_tech_guard BEFORE UPDATE ON public.service_calls
FOR EACH ROW EXECUTE FUNCTION public.service_calls_tech_guard();

-- 8 ─────────────────────────────────────────────────────────────
DO $$ DECLARE p record; BEGIN
  FOR p IN SELECT policyname FROM pg_policies
           WHERE schemaname = 'public' AND tablename = 'incoming_calls' AND cmd = 'SELECT' LOOP
    EXECUTE format('DROP POLICY %I ON public.incoming_calls', p.policyname);
  END LOOP;
END $$;
CREATE POLICY "incoming read" ON public.incoming_calls FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));
