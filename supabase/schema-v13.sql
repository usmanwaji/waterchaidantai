-- ============================================================================
-- schema-v13.sql — นับสถิติผู้เข้าชมเริ่มที่วันเปิดเว็บ 2 ต.ค. 2569 (2026-10-02)
-- รันใน Supabase: SQL Editor → New query → paste → Run (รันซ้ำได้ ปลอดภัย)
-- ต้องรัน schema-v10.sql มาก่อนแล้ว (ตาราง page_views / visit_dims และฟังก์ชันสถิติ)
--
-- ตัวนับเริ่มเก็บก่อนเปิดเว็บจริง ยอดช่วงนั้นเป็นการทดสอบของทีมเอง ไม่ใช่ผู้เข้าชม
-- ไฟล์นี้ทำสองอย่าง
--   1. ลบยอดของวันที่ก่อน 2 ต.ค. 2569 ออกจาก page_views และ visit_dims
--      ** ลบแล้วกู้คืนไม่ได้ ** ถ้าอยากเก็บไว้ดูก่อน ให้เอาเครื่องหมาย -- หน้าบรรทัด
--      "สำรองข้อมูล" ในข้อ 1 ออกก่อนกด Run
--   2. กราฟรายวัน (get_visit_daily) เริ่มที่วันเปิดเว็บ ไม่เติมแท่งศูนย์ย้อนไปก่อนหน้านั้น
--      เลือกดู 90 วันบนหน้า /statistic จะเห็นตั้งแต่ 2 ต.ค. เป็นต้นไปเท่านั้น
--
-- การ์ดหน้าแรก ("สะสมทั้งหมด ... ตั้งแต่ ...") อ่านวันแรกจากข้อมูลที่เหลือ
-- จึงเปลี่ยนเป็น 2 ต.ค. เองหลังรันไฟล์นี้ ไม่ต้องแก้โค้ดหน้าเว็บ
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. วันเปิดเว็บ — ที่เดียวที่กำหนดวันนี้ จะเลื่อนวันให้แก้ตรงนี้แล้วรันไฟล์นี้ใหม่
-- ---------------------------------------------------------------------------
create or replace function public.site_launch_day()
returns date
language sql
immutable
as $fn$ select date '2026-10-02' $fn$;

-- ---------------------------------------------------------------------------
-- 1. ลบยอดก่อนวันเปิดเว็บ
-- ---------------------------------------------------------------------------
-- ดูก่อนว่าจะลบเท่าไร (เลือกเฉพาะบรรทัดนี้แล้วกด Run):
--   select count(*) rows, sum(views) views, sum(visitors) visitors, min(day), max(day)
--     from public.page_views where day < public.site_launch_day();

-- สำรองข้อมูล (ไม่บังคับ):
-- create table if not exists public.page_views_prelaunch as
--   select * from public.page_views where day < public.site_launch_day();
-- create table if not exists public.visit_dims_prelaunch as
--   select * from public.visit_dims where day < public.site_launch_day();
-- alter table public.page_views_prelaunch enable row level security;
-- alter table public.visit_dims_prelaunch enable row level security;

delete from public.page_views where day < public.site_launch_day();
delete from public.visit_dims where day < public.site_launch_day();

-- ---------------------------------------------------------------------------
-- 2. get_visit_daily(days) — อนุกรมรายวัน เริ่มไม่ก่อนวันเปิดเว็บ
--    เหมือน v10 ทุกอย่าง ต่างแค่จุดเริ่มของ generate_series
--    ขอ 90 วันแต่เว็บเปิดมา 52 วัน → ได้ 52 แถว (หน้า /statistic รู้จากจำนวนแถว)
-- ---------------------------------------------------------------------------
create or replace function public.get_visit_daily(p_days int default 30)
returns table (day date, views bigint, visitors bigint)
language sql
stable
security definer
set search_path = public
as $fn$
  with span as (select greatest(1, least(coalesce(p_days, 30), 400)) as n)
  select g.d::date,
         coalesce(sum(v.views), 0)::bigint,
         coalesce(sum(v.visitors), 0)::bigint
  from span
  cross join generate_series(
         greatest(public.bkk_today() - (span.n - 1), public.site_launch_day()),
         public.bkk_today(),
         interval '1 day') g(d)
  left join public.page_views v on v.day = g.d::date
  group by g.d
  order by g.d;
$fn$;

-- ---------------------------------------------------------------------------
-- 3. สิทธิ์ (create or replace คงสิทธิ์เดิมไว้ แต่ระบุซ้ำให้ชัด)
-- ---------------------------------------------------------------------------
revoke all on function public.site_launch_day()     from public;
revoke all on function public.get_visit_daily(int)  from public;
grant execute on function public.site_launch_day()    to anon, authenticated;
grant execute on function public.get_visit_daily(int) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- ตรวจผล
--   select min(day) from public.page_views;                -- ต้องได้ 2026-10-02 หรือหลังจากนั้น
--   select * from public.get_visit_summary();
--   select count(*) from public.get_visit_daily(90);       -- จำนวนวันนับจาก 2 ต.ค. ถึงวันนี้
-- ---------------------------------------------------------------------------
