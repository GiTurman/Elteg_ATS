-- ქოლ-ცენტრი: ოპერატორების ცვლები, მორიგეობა და შიდა ნომრების მართვა
-- ავტორი: Giorgi Turmanidze "GT"
-- იდემპოტენტურია (განმეორებით გაშვება უსაფრთხოა).

CREATE TABLE IF NOT EXISTS public.operator_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  duty_role text NOT NULL DEFAULT 'operator'
    CHECK (duty_role IN ('operator', 'supervisor', 'oncall_technician')),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT operator_shifts_time_chk CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS operator_shifts_time_idx
  ON public.operator_shifts (starts_at, ends_at);
CREATE INDEX IF NOT EXISTS operator_shifts_profile_idx
  ON public.operator_shifts (profile_id);

ALTER TABLE public.operator_shifts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff and technicians read shifts" ON public.operator_shifts;
CREATE POLICY "staff and technicians read shifts" ON public.operator_shifts
  FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()) OR public.has_role(auth.uid(), 'technician'));

DROP POLICY IF EXISTS "staff manage shifts" ON public.operator_shifts;
CREATE POLICY "staff manage shifts" ON public.operator_shifts
  FOR ALL TO authenticated
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

-- დისპეჩერს/მენეჯერს შეუძლია ოპერატორის შიდა ნომრისა და მობილურის მითითება
-- (profiles-ის RLS სხვის პროფილს მხოლოდ მენეჯერს აძლევს, ამიტომ ვიწრო ფუნქცია).
CREATE OR REPLACE FUNCTION public.set_operator_contact(
  _profile_id uuid,
  _extension text,
  _phone text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  UPDATE public.profiles
     SET extension = NULLIF(btrim(_extension), ''),
         phone = NULLIF(btrim(_phone), '')
   WHERE id = _profile_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_operator_contact(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_operator_contact(uuid, text, text) TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'operator_shifts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.operator_shifts;
  END IF;
END $$;
