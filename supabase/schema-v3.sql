-- ============================================================================
-- schema-v3.sql — เพิ่มรายงาน "ถนนชำรุด" (ไม่ต้องมีน้ำท่วมก็รายงานได้)
-- รันใน Supabase: Dashboard → SQL Editor → New query → paste → Run
-- ปลอดภัยถ้ารันซ้ำ (IF NOT EXISTS / DROP IF EXISTS)
-- ============================================================================

-- 1) flood_reports: เพิ่มประเภทรายงาน + รายละเอียดชำรุด + รถที่ผ่านได้
ALTER TABLE public.flood_reports
  ADD COLUMN IF NOT EXISTS report_type text NOT NULL DEFAULT 'flood',
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS passable_vehicles text[];

-- จำกัดค่า report_type ('flood' = น้ำท่วม, 'damage' = ถนนชำรุด)
ALTER TABLE public.flood_reports
  DROP CONSTRAINT IF EXISTS flood_reports_report_type_check;
ALTER TABLE public.flood_reports
  ADD CONSTRAINT flood_reports_report_type_check
  CHECK (report_type IN ('flood','damage'));

-- 2) depth_cm ไม่บังคับอีกต่อไป (รายงานถนนชำรุดไม่มีความลึกน้ำ)
ALTER TABLE public.flood_reports
  ALTER COLUMN depth_cm DROP NOT NULL;
ALTER TABLE public.flood_reports
  DROP CONSTRAINT IF EXISTS flood_reports_depth_cm_check;
ALTER TABLE public.flood_reports
  ADD CONSTRAINT flood_reports_depth_cm_check
  CHECK (depth_cm IS NULL OR (depth_cm >= 0 AND depth_cm <= 500));
-- แต่รายงานน้ำท่วมยังต้องมีความลึก และรายงานชำรุดต้องมีรายละเอียด
ALTER TABLE public.flood_reports
  DROP CONSTRAINT IF EXISTS flood_reports_type_fields_check;
ALTER TABLE public.flood_reports
  ADD CONSTRAINT flood_reports_type_fields_check
  CHECK (
    (report_type = 'flood'  AND depth_cm IS NOT NULL) OR
    (report_type = 'damage' AND description IS NOT NULL)
  );

-- 3) flood_report_updates: รองรับอัปเดตรายงานชำรุด (ไม่มี depth ก็ได้)
ALTER TABLE public.flood_report_updates
  ALTER COLUMN depth_cm DROP NOT NULL;
ALTER TABLE public.flood_report_updates
  DROP CONSTRAINT IF EXISTS flood_report_updates_depth_cm_check;
ALTER TABLE public.flood_report_updates
  ADD CONSTRAINT flood_report_updates_depth_cm_check
  CHECK (depth_cm IS NULL OR (depth_cm >= 0 AND depth_cm <= 500));
ALTER TABLE public.flood_report_updates
  ADD COLUMN IF NOT EXISTS description text;

CREATE INDEX IF NOT EXISTS flood_reports_type_idx ON public.flood_reports (report_type);
