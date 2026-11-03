-- სატელეფონო სადგური (Asterisk): WebRTC მისამართი, მთავარი ნომერი და SIP საიდუმლო.
-- ავტორი: Giorgi Turmanidze "GT". იდემპოტენტურია.

ALTER TABLE public.telephony_settings
  ADD COLUMN IF NOT EXISTS pbx_wss_url text,
  ADD COLUMN IF NOT EXISTS main_number text;

-- SIP პაროლების საიდუმლო — მხოლოდ სერვერისთვის (RLS ჩართულია, პოლიტიკა არ არის)
CREATE TABLE IF NOT EXISTS public.pbx_secrets (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  sip_secret text NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.pbx_secrets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pbx_secrets FROM anon, authenticated;
INSERT INTO public.pbx_secrets (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
