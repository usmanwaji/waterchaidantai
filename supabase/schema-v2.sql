-- ============================================================================
-- schema-v2.sql
-- Run this in your Supabase SQL Editor to upgrade your database
-- for start/end points, photos, and update history.
-- ============================================================================

-- 1. Add new columns to the existing flood_reports table
-- We keep the original lat/lon as a fallback/center point, but add new ones
ALTER TABLE public.flood_reports
  ADD COLUMN IF NOT EXISTS polyline text,
  ADD COLUMN IF NOT EXISTS start_lat double precision,
  ADD COLUMN IF NOT EXISTS start_lon double precision,
  ADD COLUMN IF NOT EXISTS end_lat double precision,
  ADD COLUMN IF NOT EXISTS end_lon double precision,
  ADD COLUMN IF NOT EXISTS photo_url text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz not null default now();

-- 2. Create flood_report_updates table to track history
CREATE TABLE IF NOT EXISTS public.flood_report_updates (
  id             uuid primary key default gen_random_uuid(),
  report_id      uuid references public.flood_reports(id) on delete cascade,
  depth_cm       numeric not null check (depth_cm >= 0 and depth_cm <= 500),
  photo_url      text,
  updated_by     uuid references auth.users(id),
  updated_at     timestamptz not null default now()
);

-- RLS for flood_report_updates
ALTER TABLE public.flood_report_updates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "flood_report_updates_select_public" ON public.flood_report_updates;
CREATE POLICY "flood_report_updates_select_public"
  ON public.flood_report_updates FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "flood_report_updates_insert_approved" ON public.flood_report_updates;
CREATE POLICY "flood_report_updates_insert_approved"
  ON public.flood_report_updates FOR INSERT
  WITH CHECK (public.is_approved(auth.uid()) and updated_by = auth.uid());

-- 3. Create Storage Bucket for photos
INSERT INTO storage.buckets (id, name, public) 
VALUES ('flood_photos', 'flood_photos', true)
ON CONFLICT (id) DO NOTHING;

-- Set up storage policies so anyone can view, but only approved users can upload
DROP POLICY IF EXISTS "Public Access" ON storage.objects;
CREATE POLICY "Public Access" 
  ON storage.objects FOR SELECT 
  USING ( bucket_id = 'flood_photos' );

DROP POLICY IF EXISTS "Approved Users can upload" ON storage.objects;
CREATE POLICY "Approved Users can upload" 
  ON storage.objects FOR INSERT 
  WITH CHECK ( bucket_id = 'flood_photos' AND public.is_approved(auth.uid()) );

-- Trigger to auto-update updated_at on flood_reports
CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_flood_reports_modtime ON public.flood_reports;
CREATE TRIGGER update_flood_reports_modtime
BEFORE UPDATE ON public.flood_reports
FOR EACH ROW EXECUTE PROCEDURE update_modified_column();
