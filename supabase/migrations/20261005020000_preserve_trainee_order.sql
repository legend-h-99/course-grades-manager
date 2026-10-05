-- Encryption uses random nonces, so encrypted names cannot determine display order.
ALTER TABLE public.trainees ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0);
