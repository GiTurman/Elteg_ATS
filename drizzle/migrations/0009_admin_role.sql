-- 0009 — ადმინისტრატორის როლი (2026-11-06, გამოყენებულია ბაზაზე)
-- ავტორი: Giorgi Turmanidze "GT"
--
-- admin   = ყველა უფლება (ტელეფონია, მომხმარებლები, SMS + მენეჯერის ყველა უფლება)
-- manager = ყველაფერი, გარდა ტელეფონიის, მომხმარებლებისა და SMS-ის
-- კლიენტების/ობიექტების რედაქტირება და წაშლა — მხოლოდ მენეჯერს და ადმინს
-- (დისპეჩერს შეუძლია ახლის დამატება ზარიდან/გამოძახებიდან).

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'admin';

-- has_role(..., 'manager') ადმინზეც მართალია (ადმინი ⊇ მენეჯერი)
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles r
    WHERE r.user_id = _user_id
      AND (r.role = _role OR (_role = 'manager' AND r.role = 'admin')))
$$;

CREATE OR REPLACE FUNCTION public.is_staff(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id
    AND role IN ('dispatcher','manager','admin'))
$$;

CREATE OR REPLACE FUNCTION public.is_admin(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'admin')
$$;
GRANT EXECUTE ON FUNCTION public.is_admin(uuid) TO authenticated;

-- მომხმარებლები — მხოლოდ ადმინი
DROP POLICY IF EXISTS "manager manages roles" ON public.user_roles;
DROP POLICY IF EXISTS "admin manages roles" ON public.user_roles;
CREATE POLICY "admin manages roles" ON public.user_roles FOR ALL TO authenticated
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "manager deletes profiles" ON public.profiles;
CREATE POLICY "admin deletes profiles" ON public.profiles FOR DELETE TO authenticated
  USING (public.is_admin(auth.uid()));
DROP POLICY IF EXISTS "own profile insert" ON public.profiles;
CREATE POLICY "own profile insert" ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid() OR public.is_admin(auth.uid()));
DROP POLICY IF EXISTS "own profile update" ON public.profiles;
CREATE POLICY "own profile update" ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid() OR public.is_admin(auth.uid()));

-- ტელეფონია — მხოლოდ ადმინი
DROP POLICY IF EXISTS "staff update telephony_settings" ON public.telephony_settings;
DROP POLICY IF EXISTS "manager update telephony_settings" ON public.telephony_settings;
DROP POLICY IF EXISTS "admin update telephony_settings" ON public.telephony_settings;
CREATE POLICY "admin update telephony_settings" ON public.telephony_settings FOR UPDATE TO authenticated
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.regenerate_telephony_token()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t text;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'მხოლოდ ადმინისტრატორისთვის' USING ERRCODE = '42501';
  END IF;
  t := encode(extensions.gen_random_bytes(20), 'hex');
  UPDATE public.telephony_settings SET webhook_token = t, updated_at = now() WHERE id = 1;
  RETURN t;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_operator_contact(_profile_id uuid, _extension text, _phone text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'მხოლოდ ადმინისტრატორისთვის' USING ERRCODE = '42501';
  END IF;
  UPDATE public.profiles
     SET extension = NULLIF(btrim(_extension), ''),
         phone = NULLIF(btrim(_phone), '')
   WHERE id = _profile_id;
END;
$$;

-- კლიენტები / ობიექტები: დამატება — თანამშრომელი; რედაქტირება/წაშლა — მენეჯერი და ადმინი
DROP POLICY IF EXISTS "staff manage clients" ON public.clients;
DROP POLICY IF EXISTS "staff insert clients" ON public.clients;
DROP POLICY IF EXISTS "manager update clients" ON public.clients;
DROP POLICY IF EXISTS "manager delete clients" ON public.clients;
CREATE POLICY "staff insert clients" ON public.clients FOR INSERT TO authenticated
  WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "manager update clients" ON public.clients FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'manager')) WITH CHECK (public.has_role(auth.uid(), 'manager'));
CREATE POLICY "manager delete clients" ON public.clients FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'manager'));

DROP POLICY IF EXISTS "staff manage objects" ON public.objects;
DROP POLICY IF EXISTS "staff insert objects" ON public.objects;
DROP POLICY IF EXISTS "manager update objects" ON public.objects;
DROP POLICY IF EXISTS "staff update objects" ON public.objects;
DROP POLICY IF EXISTS "manager delete objects" ON public.objects;
CREATE POLICY "staff insert objects" ON public.objects FOR INSERT TO authenticated
  WITH CHECK (public.is_staff(auth.uid()));
-- დისპეჩერს მხოლოდ „პრევენცია შესრულდა“ (თარიღები) — დანარჩენს ტრიგერი იცავს
CREATE POLICY "staff update objects" ON public.objects FOR UPDATE TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE OR REPLACE FUNCTION public.objects_dispatcher_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE allowed text[] := ARRAY['last_maintenance_date','next_due_date','updated_at'];
BEGIN
  IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'manager') THEN
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - allowed) IS DISTINCT FROM (to_jsonb(OLD) - allowed) THEN
    RAISE EXCEPTION 'ობიექტის რედაქტირება მხოლოდ მენეჯერს და ადმინისტრატორს შეუძლია' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_objects_dispatcher_guard ON public.objects;
CREATE TRIGGER trg_objects_dispatcher_guard BEFORE UPDATE ON public.objects
FOR EACH ROW EXECUTE FUNCTION public.objects_dispatcher_guard();
CREATE POLICY "manager delete objects" ON public.objects FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'manager'));

-- არსებული მენეჯერ(ებ)ი → ადმინი
INSERT INTO public.user_roles (user_id, role)
SELECT user_id, 'admin' FROM public.user_roles WHERE role = 'manager'
ON CONFLICT DO NOTHING;
DELETE FROM public.user_roles r
 WHERE r.role = 'manager'
   AND EXISTS (SELECT 1 FROM public.user_roles a WHERE a.user_id = r.user_id AND a.role = 'admin');
