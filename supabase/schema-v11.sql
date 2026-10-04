-- ============================================================================
-- schema-v11.sql — War Room เทศบาล (warroom.html) + หน้าเจ้าหน้าที่ (staff.html)
--
--   staff_members  ทะเบียนเจ้าหน้าที่: หน่วยงาน ตำแหน่ง พื้นที่ เบอร์ และสถานะปฏิบัติงาน
--   field_reports  รายงานสถานการณ์ภาคสนามจากเจ้าหน้าที่ (ส่งจาก staff.html แสดงใน warroom.html)
--   directives     ข้อสั่งการของผู้บริหาร + การติดตามผล (สั่งการ → รับทราบ → ดำเนินการ → แล้วเสร็จ)
--
-- รันใน Supabase: SQL Editor → New query → paste → Run (รันซ้ำได้ ปลอดภัย)
-- ต้องรัน schema.sql (profiles / is_admin / is_approved) และ schema-v2.sql
-- (update_modified_column) มาก่อนแล้ว
--
-- ค่า unit ในทุกตารางคือรหัสพื้นที่ใน js/nara-units.js เช่น 'kolok' = ทม.สุไหงโก-ลก
-- 'province' = ส่วนกลางจังหวัด · 'all' = ทุกพื้นที่ (ใช้กับข้อสั่งการเท่านั้น)
-- ไม่ผูก foreign key เพื่อให้เพิ่มเทศบาลในไฟล์ js ได้โดยไม่ต้องแก้ฐานข้อมูล
--
-- PDPA: เบอร์โทรและตำแหน่งที่อยู่ของเจ้าหน้าที่ รวมถึงรายงานภาคสนาม
-- เปิดให้อ่านเฉพาะสมาชิกที่ได้รับอนุมัติแล้วเท่านั้น ไม่มีส่วนไหนเปิดสาธารณะ
-- ============================================================================

-- ===========================================================================
-- 1) staff_members — หนึ่งแถวต่อหนึ่งบัญชี (ผูกกับ auth.users)
-- ===========================================================================
create table if not exists public.staff_members (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  display_name  text not null check (char_length(display_name) between 1 and 120),
  agency        text check (agency   is null or char_length(agency)   <= 160),  -- หน่วยงาน/สังกัด
  position      text check (position is null or char_length(position) <= 120),  -- ตำแหน่ง
  unit          text check (unit     is null or char_length(unit)     <= 40),   -- พื้นที่รับผิดชอบ
  phone         text check (phone    is null or char_length(phone)    <= 40),
  line_id       text check (line_id  is null or char_length(line_id)  <= 60),
  on_duty       boolean not null default false,                                -- กำลังปฏิบัติงานอยู่
  duty_since    timestamptz,
  duty_note     text check (duty_note is null or char_length(duty_note) <= 200), -- เช่น ประจำจุด/ภารกิจ
  lat           double precision check (lat is null or lat between -90 and 90),  -- ตำแหน่งล่าสุด (ยินยอมแชร์เอง)
  lon           double precision check (lon is null or lon between -180 and 180),
  loc_at        timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
comment on table public.staff_members is
  'ทะเบียนเจ้าหน้าที่และสถานะปฏิบัติงาน (staff.html) · War Room ใช้นับกำลังพลรายพื้นที่ · อ่านได้เฉพาะสมาชิกอนุมัติ';
create index if not exists staff_members_unit_idx on public.staff_members (unit);
create index if not exists staff_members_duty_idx on public.staff_members (on_duty);

drop trigger if exists update_staff_members_modtime on public.staff_members;
create trigger update_staff_members_modtime
  before update on public.staff_members
  for each row execute procedure update_modified_column();

alter table public.staff_members enable row level security;

-- อ่าน: แถวของตัวเองเสมอ (คนที่รออนุมัติก็กรอกข้อมูลไว้ก่อนได้)
--       แอดมินเห็นทุกแถว (ใช้ประกอบการอนุมัติใน admin.html)
--       สมาชิกอนุมัติเห็นเฉพาะเจ้าหน้าที่ที่อนุมัติแล้วด้วยกัน
drop policy if exists "staff_select" on public.staff_members;
create policy "staff_select"
  on public.staff_members for select
  using (
    user_id = auth.uid()
    or public.is_admin(auth.uid())
    or (public.is_approved(auth.uid()) and public.is_approved(user_id))
  );

-- เพิ่ม/แก้: เฉพาะแถวของตัวเอง (แอดมินแก้แทนได้)
drop policy if exists "staff_insert_own" on public.staff_members;
create policy "staff_insert_own"
  on public.staff_members for insert
  with check (user_id = auth.uid());

drop policy if exists "staff_update_own_or_admin" on public.staff_members;
create policy "staff_update_own_or_admin"
  on public.staff_members for update
  using (user_id = auth.uid() or public.is_admin(auth.uid()))
  with check (user_id = auth.uid() or public.is_admin(auth.uid()));

drop policy if exists "staff_delete_own_or_admin" on public.staff_members;
create policy "staff_delete_own_or_admin"
  on public.staff_members for delete
  using (user_id = auth.uid() or public.is_admin(auth.uid()));

-- ===========================================================================
-- 2) field_reports — รายงานสถานการณ์ภาคสนาม
-- ===========================================================================
create table if not exists public.field_reports (
  id             uuid primary key default gen_random_uuid(),
  unit           text not null check (char_length(unit) <= 40),
  amphoe         text,
  place          text check (place is null or char_length(place) <= 200),     -- ชุมชน/จุด/ถนน
  kind           text not null
                   check (kind in ('flood_home','road','flash','rescue','support','shelter','other')),
  severity       text not null default 'watch'
                   check (severity in ('normal','watch','warn','danger')),
  water_cm       numeric check (water_cm is null or (water_cm >= 0 and water_cm <= 1000)),
  households     int check (households is null or households >= 0),            -- ครัวเรือนได้รับผลกระทบ
  people         int check (people is null or people >= 0),                    -- ผู้ได้รับผลกระทบ (คน)
  needs          text[] not null default '{}',                                  -- evac, boat, vehicle, food, ...
  detail         text check (detail is null or char_length(detail) <= 2000),
  photo_url      text,
  lat            double precision check (lat is null or lat between -90 and 90),
  lon            double precision check (lon is null or lon between -180 and 180),
  status         text not null default 'open' check (status in ('open','resolved')),
  resolved_at    timestamptz,
  resolved_by    uuid references auth.users(id),
  reporter_name  text,
  reporter_phone text,
  created_by     uuid references auth.users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
comment on table public.field_reports is
  'รายงานสถานการณ์ภาคสนามจากเจ้าหน้าที่ (staff.html) แสดงใน War Room เทศบาล (warroom.html)';
create index if not exists field_reports_created_idx on public.field_reports (created_at desc);
create index if not exists field_reports_unit_idx    on public.field_reports (unit);
create index if not exists field_reports_status_idx  on public.field_reports (status);

drop trigger if exists update_field_reports_modtime on public.field_reports;
create trigger update_field_reports_modtime
  before update on public.field_reports
  for each row execute procedure update_modified_column();

-- คนที่ไม่ใช่ผู้รายงานหรือแอดมิน (เช่น ผู้บริหารใน War Room) ปิด/เปิดเหตุได้อย่างเดียว
-- แก้เนื้อหารายงานของคนอื่นไม่ได้ · ใครปิดเหตุเมื่อไรบันทึกให้อัตโนมัติ
-- auth.uid() เป็น null = SQL Editor / service_role ซึ่งแก้ได้ทุกช่อง
create or replace function public.field_reports_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is null then return new; end if;
  if not (old.created_by = auth.uid() or public.is_admin(auth.uid())) then
    new.unit := old.unit; new.amphoe := old.amphoe; new.place := old.place;
    new.kind := old.kind; new.severity := old.severity; new.water_cm := old.water_cm;
    new.households := old.households; new.people := old.people; new.needs := old.needs;
    new.detail := old.detail; new.photo_url := old.photo_url; new.lat := old.lat; new.lon := old.lon;
    new.reporter_name := old.reporter_name; new.reporter_phone := old.reporter_phone;
  end if;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  if new.status is distinct from old.status then
    if new.status = 'resolved' then
      new.resolved_at := now(); new.resolved_by := auth.uid();
    else
      new.resolved_at := null; new.resolved_by := null;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists field_reports_guard_trg on public.field_reports;
create trigger field_reports_guard_trg
  before update on public.field_reports
  for each row execute function public.field_reports_guard();

alter table public.field_reports enable row level security;

drop policy if exists "field_reports_select_approved" on public.field_reports;
create policy "field_reports_select_approved"
  on public.field_reports for select
  using (public.is_approved(auth.uid()));

drop policy if exists "field_reports_insert_approved" on public.field_reports;
create policy "field_reports_insert_approved"
  on public.field_reports for insert
  with check (public.is_approved(auth.uid()) and created_by = auth.uid());

drop policy if exists "field_reports_update_approved" on public.field_reports;
create policy "field_reports_update_approved"
  on public.field_reports for update
  using (public.is_approved(auth.uid()))
  with check (public.is_approved(auth.uid()));

drop policy if exists "field_reports_delete_own_or_admin" on public.field_reports;
create policy "field_reports_delete_own_or_admin"
  on public.field_reports for delete
  using (created_by = auth.uid() or public.is_admin(auth.uid()));

-- ===========================================================================
-- 3) directives — ข้อสั่งการของผู้บริหาร + สถานะการดำเนินการ
-- ===========================================================================
create table if not exists public.directives (
  id              uuid primary key default gen_random_uuid(),
  unit            text not null default 'all' check (char_length(unit) <= 40),
  assignee        text check (assignee is null or char_length(assignee) <= 200),  -- หน่วยรับผิดชอบ
  title           text not null check (char_length(title) between 1 and 200),
  detail          text check (detail is null or char_length(detail) <= 2000),
  priority        text not null default 'normal' check (priority in ('normal','urgent','critical')),
  due_at          timestamptz,
  status          text not null default 'ordered'
                    check (status in ('ordered','acknowledged','in_progress','done','cancelled')),
  status_note     text check (status_note is null or char_length(status_note) <= 500),
  status_at       timestamptz,
  status_by       uuid references auth.users(id),
  status_by_name  text,
  ordered_by_name text,                                                             -- ผู้สั่งการ (ตำแหน่ง/ชื่อ)
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
comment on table public.directives is
  'ข้อสั่งการผู้บริหารใน War Room เทศบาล พร้อมสถานะการติดตาม · เจ้าหน้าที่อัปเดตสถานะจาก staff.html';
create index if not exists directives_created_idx on public.directives (created_at desc);
create index if not exists directives_status_idx  on public.directives (status);
create index if not exists directives_unit_idx    on public.directives (unit);

drop trigger if exists update_directives_modtime on public.directives;
create trigger update_directives_modtime
  before update on public.directives
  for each row execute procedure update_modified_column();

-- ผู้ที่ไม่ใช่ผู้สั่งการหรือแอดมิน อัปเดตได้เฉพาะสถานะและหมายเหตุ
-- เนื้อหาข้อสั่งการจึงเปลี่ยนไม่ได้หลังสั่งไปแล้ว · บันทึกเวลาและผู้เปลี่ยนสถานะให้อัตโนมัติ
create or replace function public.directives_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is null then return new; end if;
  if not (old.created_by = auth.uid() or public.is_admin(auth.uid())) then
    new.unit := old.unit; new.assignee := old.assignee; new.title := old.title;
    new.detail := old.detail; new.priority := old.priority; new.due_at := old.due_at;
    new.ordered_by_name := old.ordered_by_name;
  end if;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  if new.status is distinct from old.status or new.status_note is distinct from old.status_note then
    new.status_at := now();
    new.status_by := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists directives_guard_trg on public.directives;
create trigger directives_guard_trg
  before update on public.directives
  for each row execute function public.directives_guard();

alter table public.directives enable row level security;

drop policy if exists "directives_select_approved" on public.directives;
create policy "directives_select_approved"
  on public.directives for select
  using (public.is_approved(auth.uid()));

drop policy if exists "directives_insert_approved" on public.directives;
create policy "directives_insert_approved"
  on public.directives for insert
  with check (public.is_approved(auth.uid()) and created_by = auth.uid());

drop policy if exists "directives_update_approved" on public.directives;
create policy "directives_update_approved"
  on public.directives for update
  using (public.is_approved(auth.uid()))
  with check (public.is_approved(auth.uid()));

drop policy if exists "directives_delete_own_or_admin" on public.directives;
create policy "directives_delete_own_or_admin"
  on public.directives for delete
  using (created_by = auth.uid() or public.is_admin(auth.uid()));

-- ============================================================================
-- เสร็จ. ตรวจเองได้ที่ SQL Editor เช่น
--   select unit, count(*) filter (where on_duty) as on_duty from public.staff_members group by unit;
--   select unit, severity, count(*) from public.field_reports where status = 'open' group by 1, 2;
--   select status, count(*) from public.directives group by status;
-- ============================================================================
