-- ============================================================================
-- schema-v9.sql — page_views (ตัวนับผู้เข้าชม มุมขวาล่างของทุกหน้า)
-- รันใน Supabase: SQL Editor → New query → paste → Run
--
-- เก็บเฉพาะ "จำนวนครั้ง" ต่อหน้า ต่อวัน — ไม่เก็บ IP, ไม่เก็บ user-agent,
-- ไม่เก็บ cookie และไม่ผูกกับตัวบุคคล (สอดคล้อง PDPA)
--
-- ตารางนี้ปิด RLS ไว้ทั้งหมด (ไม่มี policy) — ผู้ใช้ทั่วไปอ่าน/เขียนตรง ๆ ไม่ได้
-- ต้องผ่านฟังก์ชัน security definer สองตัวด้านล่างเท่านั้น
-- ============================================================================

create table if not exists public.page_views (
  path  text   not null,          -- '/', '/map.html', ... (normalize มาจากฝั่ง client)
  day   date   not null,          -- วันที่ตามเวลาไทย
  views bigint not null default 0,
  primary key (path, day)
);
comment on table public.page_views is 'ตัวนับผู้เข้าชมรายหน้า/รายวัน — ข้อมูลรวม ไม่ระบุตัวบุคคล';

alter table public.page_views enable row level security;
-- ไม่สร้าง policy ใด ๆ โดยตั้งใจ → anon/authenticated แตะตารางตรง ๆ ไม่ได้

-- ---------------------------------------------------------------------------
-- bump_page_view(path) — นับ +1 ให้หน้านั้นของวันนี้ แล้วคืนยอดรวม/ยอดวันนี้
-- ---------------------------------------------------------------------------
create or replace function public.bump_page_view(p_path text)
returns table (total bigint, today bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_path  text;
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
begin
  -- กันค่าเพี้ยน/ยาวเกิน: ตัดที่ 120 ตัวอักษร ค่าว่างถือเป็นหน้าแรก
  v_path := left(coalesce(nullif(btrim(p_path), ''), '/'), 120);

  insert into public.page_views (path, day, views)
  values (v_path, v_today, 1)
  on conflict (path, day) do update
    set views = page_views.views + 1;

  return query
    select coalesce(sum(v.views), 0)::bigint,
           coalesce(sum(v.views) filter (where v.day = v_today), 0)::bigint
    from public.page_views v;
end;
$$;

-- ---------------------------------------------------------------------------
-- get_page_views() — อ่านยอดอย่างเดียว (ใช้ตอนที่ session นี้นับไปแล้ว)
-- ---------------------------------------------------------------------------
create or replace function public.get_page_views()
returns table (total bigint, today bigint)
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(v.views), 0)::bigint,
         coalesce(sum(v.views) filter (where v.day = (now() at time zone 'Asia/Bangkok')::date), 0)::bigint
  from public.page_views v;
$$;

-- สิทธิ์: เรียกได้ทุกคน (รวมผู้ไม่ล็อกอิน) แต่ทำได้แค่สิ่งที่ฟังก์ชันกำหนดไว้
revoke all on function public.bump_page_view(text) from public;
revoke all on function public.get_page_views()     from public;
grant execute on function public.bump_page_view(text) to anon, authenticated;
grant execute on function public.get_page_views()     to anon, authenticated;

-- ---------------------------------------------------------------------------
-- ดูสถิติย้อนหลังเองได้ที่ SQL Editor เช่น
--   select day, sum(views) from public.page_views group by day order by day desc limit 30;
--   select path, sum(views) from public.page_views group by path order by 2 desc;
-- ---------------------------------------------------------------------------
