-- Add assessment category column (coursework = أعمال سنة, final = نهائي).
-- Existing rows default to 'coursework'.
ALTER TABLE public.assessments
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'coursework'
    CHECK (category IN ('coursework', 'final'));
