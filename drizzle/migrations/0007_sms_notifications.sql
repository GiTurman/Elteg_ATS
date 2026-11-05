-- 0007 — SMS შეტყობინებები კლიენტებს (შემომავალ ზარზე პაკეტის ინფორმაცია, სტატუსის ცვლილება)
-- ავტორი: Giorgi Turmanidze "GT"
-- პარამეტრები და გასაღები იკითხება/იწერება მხოლოდ სერვერიდან (service_role); ჟურნალი — თანამშრომლებს.

CREATE TABLE IF NOT EXISTS public.sms_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled boolean NOT NULL DEFAULT false,
  sender text NOT NULL DEFAULT '',
  translit boolean NOT NULL DEFAULT false,
  inbound_enabled boolean NOT NULL DEFAULT true,
  inbound_template text NOT NULL DEFAULT '',
  inbound_unknown_template text NOT NULL DEFAULT '',
  dedupe_minutes integer NOT NULL DEFAULT 60 CHECK (dedupe_minutes BETWEEN 1 AND 10080),
  status_templates jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.sms_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sms_settings FROM anon, authenticated;
GRANT ALL ON public.sms_settings TO service_role;

CREATE TABLE IF NOT EXISTS public.sms_secrets (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  api_key text
);
ALTER TABLE public.sms_secrets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sms_secrets FROM anon, authenticated;
GRANT ALL ON public.sms_secrets TO service_role;

CREATE TABLE IF NOT EXISTS public.sms_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  kind text NOT NULL CHECK (kind IN ('inbound','status','test')),
  to_number text,
  body text NOT NULL DEFAULT '',
  ok boolean NOT NULL DEFAULT false,
  error text,
  provider_code integer,
  service_call_id uuid REFERENCES public.service_calls(id) ON DELETE SET NULL,
  call_log_id uuid REFERENCES public.call_logs(id) ON DELETE SET NULL,
  status public.call_status
);
CREATE INDEX IF NOT EXISTS sms_log_created_idx ON public.sms_log (created_at DESC);
CREATE INDEX IF NOT EXISTS sms_log_to_idx ON public.sms_log (to_number, created_at DESC);
CREATE INDEX IF NOT EXISTS sms_log_call_idx ON public.sms_log (service_call_id, status);
ALTER TABLE public.sms_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sms_log FROM anon, authenticated;
GRANT SELECT ON public.sms_log TO authenticated;
GRANT ALL ON public.sms_log TO service_role;
CREATE POLICY "staff read sms_log" ON public.sms_log FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));
