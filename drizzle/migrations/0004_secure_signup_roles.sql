-- უსაფრთხოება: თვითრეგისტრაციით როლი აღარ ენიჭება; წვდომას აძლევს მხოლოდ მენეჯერი.
-- ავტორი: Giorgi Turmanidze "GT". იდემპოტენტურია.

-- 1. ახალი მომხმარებელი: მხოლოდ პროფილი, როლის გარეშე (metadata-ს role იგნორირდება)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (id, full_name, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', ''), NEW.email)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$function$;

-- 2. სისტემის მფლობელი → მენეჯერი (მფლობელის თანხმობით, 03.11.2026)
DELETE FROM public.user_roles ur
 USING public.profiles p
 WHERE ur.user_id = p.id
   AND lower(p.email) = 'g.turmanidze.elteg@gmail.com'
   AND ur.role <> 'manager';
INSERT INTO public.user_roles (user_id, role)
SELECT p.id, 'manager'::public.app_role
  FROM public.profiles p
 WHERE lower(p.email) = 'g.turmanidze.elteg@gmail.com'
   AND NOT EXISTS (
     SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p.id AND ur.role = 'manager'
   );

-- 3. „ყველასთვის ღია“ SELECT პოლიტიკები → მხოლოდ როლის მქონე თანამშრომლები
--    (profiles და user_roles რჩება წაკითხვადი — საჭიროა შესვლისა და სახელების საჩვენებლად)
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT tablename, policyname
      FROM pg_policies
     WHERE schemaname = 'public'
       AND cmd = 'SELECT'
       AND qual = 'true'
       AND tablename NOT IN ('profiles', 'user_roles')
  LOOP
    EXECUTE format(
      'ALTER POLICY %I ON public.%I USING (public.is_staff(auth.uid()) OR public.has_role(auth.uid(), %L::public.app_role))',
      r.policyname, r.tablename, 'technician'
    );
  END LOOP;
END $$;
