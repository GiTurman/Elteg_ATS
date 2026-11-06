-- 0010 — მომსახურების პაკეტები (ეკონომი / სტანდარტი / პრემიუმი), ორი ფასთა სია (გამოყენებულია 06.11.2026)
-- ავტორი: Giorgi Turmanidze "GT"
-- წყარო: „ლიფტების მომსახურების პაკეტები“ (PDF, 2 ვერსია) — ფასები დღგ-ს ჩათვლით, 1 სამგზავრო ლიფტზე.

ALTER TABLE public.tariff_packages
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'GEL',
  ADD COLUMN IF NOT EXISTS price_list text,
  ADD COLUMN IF NOT EXISTS calls_mode text
    CHECK (calls_mode IN ('limited','unlimited','working_hours','extra_charge')),
  ADD COLUMN IF NOT EXISTS included_calls integer,
  ADD COLUMN IF NOT EXISTS planned_visits integer,
  ADD COLUMN IF NOT EXISTS after_hours_service boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS response_minutes_work integer,
  ADD COLUMN IF NOT EXISTS response_minutes_after integer,
  ADD COLUMN IF NOT EXISTS entrapment_response text;

-- არსებული (ინდივიდუალური ხელშეკრულებების) პაკეტები — სახელის დაზუსტება, კლიენტები რჩება მიბმული
UPDATE public.tariff_packages SET name = 'სტანდარტი (ინდივიდუალური)', sort_order = 90 WHERE code = 'standard';
UPDATE public.tariff_packages SET name = 'პრემიუმი (ინდივიდუალური)', sort_order = 91 WHERE code = 'premium';
UPDATE public.tariff_packages SET is_active = false, sort_order = 99
 WHERE code = 'platinum' AND NOT EXISTS (SELECT 1 FROM public.clients c WHERE c.package_id = tariff_packages.id);

INSERT INTO public.tariff_packages
  (code, name, price_list, price_monthly, currency, response_sla_hours, response_minutes_work,
   response_minutes_after, entrapment_response, calls_mode, included_calls, planned_visits,
   after_hours_service, included_services, description, sort_order, is_active)
VALUES
  ('economy_a',  'ეკონომი (90$)',    'ფასთა სია 1', 90,  'USD', 3, 150, NULL, '24/7, 30–40 წუთი', 'limited', 3,    1, false,
   'გეგმური სერვისი თვეში 1-ჯერ (სამუშაო დღე), შემოწმების აქტი, ავარიული გამოძახება სამუშაო დღეს, 3 გამოძახება თვეში',
   'ტექნიკური გაუმართაობა: სამუშაო დღეს 150 წთ; არასამუშაო დროს — არ შედის. გაჭედვა: 24/7, 30–40 წთ.', 10, true),
  ('standard_a', 'სტანდარტი (100$)', 'ფასთა სია 1', 100, 'USD', 2, 120, 150,  '24/7, 30–40 წუთი', 'limited', 5,    1, false,
   'გეგმური სერვისი თვეში 1-ჯერ (სამუშაო დღე), შემოწმების აქტი, ავარიული გამოძახება სამუშაო დღეს, 5 გამოძახება თვეში',
   'ტექნიკური გაუმართაობა: სამუშაო დღეს 120 წთ, არასამუშაო დროს 150 წთ. გაჭედვა: 24/7, 30–40 წთ.', 11, true),
  ('premium_a',  'პრემიუმი (115$)',  'ფასთა სია 1', 115, 'USD', 1, 60,  120,  '24/7, 30–40 წუთი', 'unlimited', NULL, 1, true,
   'გეგმური სერვისი თვეში 1-ჯერ (სამუშაო და არასამუშაო დრო), შემოწმების აქტი, ავარიული გამოძახება ნებისმიერ დროს, ულიმიტო გამოძახება',
   'ტექნიკური გაუმართაობა: სამუშაო დღეს 60 წთ, არასამუშაო დროს 120 წთ. გაჭედვა: 24/7, 30–40 წთ.', 12, true),
  ('economy_b',  'ეკონომი (100$)',   'ფასთა სია 2', 100, 'USD', 3, 150, NULL, '24/7, 30–40 წუთი', 'limited', 3,    1, false,
   'გეგმური სერვისი თვეში 1-ჯერ (სამუშაო დღე), შემოწმების აქტი, ავარიული გამოძახება სამუშაო დღეს, 3 გამოძახება თვეში',
   'ტექნიკური გაუმართაობა: სამუშაო დღეს 150 წთ; არასამუშაო დროს — არ შედის. გაჭედვა: 24/7, 30–40 წთ.', 20, true),
  ('standard_b', 'სტანდარტი (120$)', 'ფასთა სია 2', 120, 'USD', 2, 120, 150,  '24/7, 30–40 წუთი', 'unlimited', NULL, 1, false,
   'გეგმური სერვისი თვეში 1-ჯერ (სამუშაო დღე), შემოწმების აქტი, ავარიული გამოძახება სამუშაო დღეს, ულიმიტო გამოძახება',
   'ტექნიკური გაუმართაობა: სამუშაო დღეს 120 წთ, არასამუშაო დროს 150 წთ. გაჭედვა: 24/7, 30–40 წთ.', 21, true),
  ('premium_b',  'პრემიუმი (150$)',  'ფასთა სია 2', 150, 'USD', 1, 60,  120,  '24/7, 30–40 წუთი', 'unlimited', NULL, 1, true,
   'გეგმური სერვისი თვეში 1-ჯერ (სამუშაო და არასამუშაო დრო), შემოწმების აქტი, ავარიული გამოძახება ნებისმიერ დროს, ულიმიტო გამოძახება',
   'ტექნიკური გაუმართაობა: სამუშაო დღეს 60 წთ, არასამუშაო დროს 120 წთ. გაჭედვა: 24/7, 30–40 წთ.', 22, true)
ON CONFLICT DO NOTHING;
