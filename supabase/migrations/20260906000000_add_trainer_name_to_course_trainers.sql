-- Add missing trainer identity columns to course_trainers.
-- These are referenced by the Worker (saveWorkspace/loadWorkspace) and
-- the join_course_by_code RPC, but were absent from the initial DB schema,
-- causing every save and load to fail.
ALTER TABLE public.course_trainers
  ADD COLUMN IF NOT EXISTS trainer_name    text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS employee_number text NOT NULL DEFAULT '';
