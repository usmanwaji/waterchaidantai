-- ============================================================================
-- schema-v10.sql — สถิติผู้เข้าชม (รายวัน / 7 วัน / 30 วัน) + กระดานเชิงลึกของแอดมิน
-- รันใน Supabase: SQL Editor → New query → paste → Run  (ต้องรัน schema-v9.sql มาก่อน)
--
-- หลักการเดียวกับ v9 คือเก็บเป็น "ยอดรวม" เท่านั้น
--   ไม่เก็บ IP · ไม่เก็บ user-agent เต็ม · ไม่เก็บ cookie · ไม่ผูกกับตัวบุคคล
--   ฝั่งเบราว์เซอร์เก็บแค่ "วันที่ที่นับไปแล้ว" ไว้ใน localStorage เพื่อไม่ให้นับซ้ำ
--   ไม่มีรหัสประจำตัวผู้เข้าชมอยู่ที่ไหนเลย ทั้งบนเครื่องและบนฐานข้อมูล (PDPA)
--
-- คำนิยามที่ใช้ทั้งระบบ
--   "ครั้งที่เปิดหน้า" (views)  = เปิดหน้าเว็บ 1 ครั้ง นับ 1 (กด F5 ซ้ำใน session เดิมไม่นับ)
--   "ผู้เข้าชม" (visitors)      = เบราว์เซอร์ 1 เครื่อง ต่อ 1 วัน นับ 1
--   ในตาราง page_views คอลัมน์ visitors จึงหมายถึง "คนที่เปิดหน้านี้เป็นหน้าแรกของวัน"
--   รวมทุกหน้าของวันเดียวกันจะได้จำนวนผู้เข้าชมของวันนั้นพอดี ไม่นับซ้ำ
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. ขยายตารางเดิมให้เก็บจำนวนผู้เข้าชม (ของเดิมเก็บแต่จำนวนครั้ง)
-- ---------------------------------------------------------------------------
alter table public.page_views
  add column if not exists visitors bigint not null default 0;

comment on column public.page_views.visitors is
  'ผู้เข้าชมที่เปิดหน้านี้เป็นหน้าแรกของวัน — รวมทุกหน้าในวันเดียวกัน = ผู้เข้าชมของวันนั้น';

-- ---------------------------------------------------------------------------
-- 2. มิติเสริม: อุปกรณ์ / ที่มา / ชั่วโมง — เก็บเป็นยอดรวมรายวันเช่นกัน
--    ที่มาเก็บเฉพาะ "ชื่อโฮสต์" ไม่เก็บ URL เต็มและไม่เก็บ query string
-- ---------------------------------------------------------------------------
create table if not exists public.visit_dims (
  day   date   not null,
  dim   text   not null check (dim in ('device','ref','hour')),
  key   text   not null,
  views bigint not null default 0,
  primary key (day, dim, key)
);
comment on table public.visit_dims is
  'ยอดรวมรายวันแยกตามอุปกรณ์ / ที่มา / ชั่วโมง — ไม่ระบุตัวบุคคล';

alter table public.visit_dims enable row level security;
-- ไม่สร้าง policy โดยตั้งใจ → แตะตารางตรง ๆ ไม่ได้ ต้องผ่านฟังก์ชันด้านล่างเท่านั้น

-- ---------------------------------------------------------------------------
-- 3. ตัวช่วย
-- ---------------------------------------------------------------------------

-- "วันนี้" ตามเวลาไทย — ใช้ร่วมกันทุกฟังก์ชัน กันวันเหลื่อมกันเอง
create or replace function public.bkk_today()
returns date
language sql
stable
as $fn$ select (now() at time zone 'Asia/Bangkok')::date $fn$;

-- แอดมินของระบบ — ใช้กั้นสถิติเชิงลึก
create or replace function public.is_site_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and status = 'approved'
  );
$fn$;

-- ---------------------------------------------------------------------------
-- 4. track_view() — ตัวนับตัวใหม่
--    bump_page_view() ของ v9 ยังอยู่ เพื่อรองรับเบราว์เซอร์ที่ยังแคช views.js ตัวเก่า
-- ---------------------------------------------------------------------------
create or replace function public.track_view(
  p_path        text,
  p_new_visitor boolean default false,
  p_device      text    default null,
  p_ref         text    default null,
  p_hour        int     default null
)
returns table (total bigint, today bigint, visitors_today bigint)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_today date := public.bkk_today();
  v_path  text;
  v_dev   text;
  v_ref   text;
  v_hour  int;
  v_new   int := case when p_new_visitor then 1 else 0 end;
begin
  -- ค่าที่ส่งมาจากเบราว์เซอร์เชื่อไม่ได้ ต้องคัดทุกตัวก่อนเขียนลงตาราง
  v_path := left(coalesce(nullif(btrim(p_path), ''), '/'), 120);

  v_dev := case when p_device in ('mobile','tablet','desktop') then p_device else 'unknown' end;

  v_ref := lower(left(coalesce(nullif(btrim(p_ref), ''), 'direct'), 80));
  if v_ref <> 'direct' and v_ref !~ '^[a-z0-9][a-z0-9._-]*$' then
    v_ref := 'other';                       -- ไม่ใช่ชื่อโฮสต์ → ไม่เก็บของแปลกปลอม
  end if;

  v_hour := coalesce(p_hour, extract(hour from (now() at time zone 'Asia/Bangkok'))::int);
  if v_hour < 0 or v_hour > 23 then
    v_hour := extract(hour from (now() at time zone 'Asia/Bangkok'))::int;
  end if;

  insert into public.page_views (path, day, views, visitors)
  values (v_path, v_today, 1, v_new)
  on conflict (path, day) do update
    set views    = page_views.views + 1,
        visitors = page_views.visitors + v_new;

  insert into public.visit_dims (day, dim, key, views) values
    (v_today, 'device', v_dev,                     1),
    (v_today, 'ref',    v_ref,                     1),
    (v_today, 'hour',   lpad(v_hour::text, 2, '0'), 1)
  on conflict (day, dim, key) do update
    set views = visit_dims.views + 1;

  return query
    select coalesce(sum(v.views), 0)::bigint,
           coalesce(sum(v.views)    filter (where v.day = v_today), 0)::bigint,
           coalesce(sum(v.visitors) filter (where v.day = v_today), 0)::bigint
    from public.page_views v;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 5. get_visit_summary() — ตัวเลขของการ์ดหน้าแรก (เปิดให้ทุกคนอ่าน)
--    ทุกช่วงนับรวมวันนี้: 7 วัน = วันนี้ย้อนไป 6 วัน
--    prev_* คือช่วงก่อนหน้าที่ยาวเท่ากัน ใช้บอกว่าเพิ่มขึ้น/ลดลงกี่เปอร์เซ็นต์
-- ---------------------------------------------------------------------------
create or replace function public.get_visit_summary()
returns table (
  views_today  bigint, visitors_today  bigint,
  views_7      bigint, visitors_7      bigint,
  views_30     bigint, visitors_30     bigint,
  views_total  bigint, visitors_total  bigint,
  views_prev7  bigint, visitors_prev7  bigint,
  views_prev30 bigint, visitors_prev30 bigint,
  first_day    date
)
language sql
stable
security definer
set search_path = public
as $fn$
  select
    coalesce(sum(v.views)    filter (where v.day =  public.bkk_today()), 0)::bigint,
    coalesce(sum(v.visitors) filter (where v.day =  public.bkk_today()), 0)::bigint,
    coalesce(sum(v.views)    filter (where v.day >= public.bkk_today() -  6), 0)::bigint,
    coalesce(sum(v.visitors) filter (where v.day >= public.bkk_today() -  6), 0)::bigint,
    coalesce(sum(v.views)    filter (where v.day >= public.bkk_today() - 29), 0)::bigint,
    coalesce(sum(v.visitors) filter (where v.day >= public.bkk_today() - 29), 0)::bigint,
    coalesce(sum(v.views), 0)::bigint,
    coalesce(sum(v.visitors), 0)::bigint,
    coalesce(sum(v.views)    filter (where v.day between public.bkk_today() - 13 and public.bkk_today() -  7), 0)::bigint,
    coalesce(sum(v.visitors) filter (where v.day between public.bkk_today() - 13 and public.bkk_today() -  7), 0)::bigint,
    coalesce(sum(v.views)    filter (where v.day between public.bkk_today() - 59 and public.bkk_today() - 30), 0)::bigint,
    coalesce(sum(v.visitors) filter (where v.day between public.bkk_today() - 59 and public.bkk_today() - 30), 0)::bigint,
    min(v.day)
  from public.page_views v;
$fn$;

-- ---------------------------------------------------------------------------
-- 6. get_visit_daily(days) — อนุกรมรายวันสำหรับกราฟแท่ง
--    เติมวันที่ไม่มีคนเข้าให้เป็น 0 เพื่อไม่ให้กราฟบิด
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
         public.bkk_today() - (span.n - 1),
         public.bkk_today(),
         interval '1 day') g(d)
  left join public.page_views v on v.day = g.d::date
  group by g.d
  order by g.d;
$fn$;

-- ---------------------------------------------------------------------------
-- 7. สถิติเชิงลึก — เฉพาะแอดมินเท่านั้น
--    ฟังก์ชันเป็น security definer จึงต้องตรวจสิทธิ์เองในตัวฟังก์ชัน
-- ---------------------------------------------------------------------------

-- หน้าไหนคนเปิดมากที่สุด
create or replace function public.admin_visit_pages(p_days int default 30)
returns table (path text, views bigint, visitors bigint)
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare v_n int := greatest(1, least(coalesce(p_days, 30), 400));
begin
  if not public.is_site_admin() then
    raise exception 'ต้องเป็นผู้ดูแลระบบจึงจะดูสถิติเชิงลึกได้' using errcode = '42501';
  end if;
  return query
    select v.path, sum(v.views)::bigint, sum(v.visitors)::bigint
    from public.page_views v
    where v.day >= public.bkk_today() - (v_n - 1)
    group by v.path
    order by 2 desc
    limit 100;
end;
$fn$;

-- แยกตามมิติ: device / ref / hour
create or replace function public.admin_visit_dim(p_dim text, p_days int default 30)
returns table (key text, views bigint)
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_n int  := greatest(1, least(coalesce(p_days, 30), 400));
  v_d text := coalesce(p_dim, '');
begin
  if not public.is_site_admin() then
    raise exception 'ต้องเป็นผู้ดูแลระบบจึงจะดูสถิติเชิงลึกได้' using errcode = '42501';
  end if;
  if v_d not in ('device','ref','hour') then
    raise exception 'มิติไม่ถูกต้อง: %', v_d using errcode = '22023';
  end if;
  return query
    select d.key, sum(d.views)::bigint
    from public.visit_dims d
    where d.dim = v_d and d.day >= public.bkk_today() - (v_n - 1)
    group by d.key
    order by case when v_d = 'hour' then d.key end asc, 2 desc
    limit 60;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 8. สิทธิ์การเรียก
-- ---------------------------------------------------------------------------
revoke all on function public.track_view(text, boolean, text, text, int) from public;
revoke all on function public.get_visit_summary()       from public;
revoke all on function public.get_visit_daily(int)      from public;
revoke all on function public.admin_visit_pages(int)    from public;
revoke all on function public.admin_visit_dim(text,int) from public;
revoke all on function public.is_site_admin()           from public;
revoke all on function public.bkk_today()               from public;

grant execute on function public.track_view(text, boolean, text, text, int) to anon, authenticated;
grant execute on function public.get_visit_summary()       to anon, authenticated;
grant execute on function public.get_visit_daily(int)      to anon, authenticated;
grant execute on function public.bkk_today()               to anon, authenticated;
grant execute on function public.is_site_admin()           to authenticated;
grant execute on function public.admin_visit_pages(int)    to authenticated;
grant execute on function public.admin_visit_dim(text,int) to authenticated;

-- ---------------------------------------------------------------------------
-- ตรวจเองได้ที่ SQL Editor
--   select * from public.get_visit_summary();
--   select * from public.get_visit_daily(14);
--   select day, sum(views) v, sum(visitors) u
--     from public.page_views group by day order by day desc limit 30;
-- ---------------------------------------------------------------------------
