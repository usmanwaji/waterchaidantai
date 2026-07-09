-- ============================================================================
-- schema-v5.sql — ตารางจักรกลสาธารณภัย (หน้า ทรัพยากร / resources.html)
-- รันใน Supabase: Dashboard → SQL Editor → New query → paste → Run
-- ใช้ระบบสมาชิกเดิม (profiles / is_admin / is_approved) และ bucket รูปเดิม
-- ============================================================================

create table if not exists public.machinery (
  id                uuid primary key default gen_random_uuid(),
  lat               double precision not null check (lat between -90 and 90),
  lon               double precision not null check (lon between -180 and 180),
  name              text not null,             -- ชื่อเครื่องจักร เช่น "เรือท้องแบน ปภ.นธ-01"
  type              text not null,             -- รหัสประเภท (boat, pump_long, ...)
  details           text,                      -- รายละเอียด/ขีดความสามารถ
  photo_url         text,
  location_name     text,                      -- ชื่อจุดที่ประจำการ เช่น "วัดบางนรา"
  deployed_from     date,                      -- ประจำจุดนี้ตั้งแต่
  deployed_until    date,                      -- ประจำจุดนี้ถึง (null = ไม่กำหนด)
  first_deployed    date,                      -- เริ่มปฏิบัติภารกิจครั้งแรก
  demob_date        date,                      -- กำหนดถอนกลับที่ตั้ง (null = ไม่กำหนด)
  coordinator_name  text not null,             -- ผู้ประสานงาน
  coordinator_phone text not null,             -- หมายเลขโทรศัพท์
  agency            text,                      -- หน่วยงานเจ้าของเครื่องจักร
  status            text not null default 'deployed' check (status in ('deployed','demobilized')),
  created_by        uuid references auth.users(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.machinery is
  'จักรกลสาธารณภัยที่ประจำการในพื้นที่ แสดงบนแผนที่หน้า resources.html';

create index if not exists machinery_status_idx on public.machinery (status);
create index if not exists machinery_type_idx on public.machinery (type);

-- updated_at อัตโนมัติ (ใช้ฟังก์ชันเดิมจาก schema-v2)
drop trigger if exists update_machinery_modtime on public.machinery;
create trigger update_machinery_modtime
  before update on public.machinery
  for each row execute procedure update_modified_column();

-- ---------------------------------------------------------------------------
-- Row Level Security — กติกาเดียวกับ flood_reports
-- ---------------------------------------------------------------------------
alter table public.machinery enable row level security;

-- ดูได้เฉพาะผู้ที่ log in สำเร็จแล้วเท่านั้น (ปกป้องข้อมูลติดต่อเจ้าหน้าที่
-- แม้จะเรียกผ่าน API ตรงๆ โดยไม่ผ่านหน้าเว็บก็ดึงข้อมูลไม่ได้ถ้าไม่ล็อกอิน)
drop policy if exists "machinery_select_public" on public.machinery;
drop policy if exists "machinery_select_authenticated" on public.machinery;
create policy "machinery_select_authenticated"
  on public.machinery for select
  using (auth.uid() is not null);

-- เพิ่มได้เฉพาะสมาชิกที่อนุมัติแล้ว
drop policy if exists "machinery_insert_approved" on public.machinery;
create policy "machinery_insert_approved"
  on public.machinery for insert
  with check (public.is_approved(auth.uid()) and created_by = auth.uid());

-- แก้ไขได้เฉพาะเจ้าของหมุด หรือแอดมิน
drop policy if exists "machinery_update_own_or_admin" on public.machinery;
create policy "machinery_update_own_or_admin"
  on public.machinery for update
  using (created_by = auth.uid() or public.is_admin(auth.uid()))
  with check (created_by = auth.uid() or public.is_admin(auth.uid()));

-- ลบได้เฉพาะเจ้าของหมุด หรือแอดมิน
drop policy if exists "machinery_delete_own_or_admin" on public.machinery;
create policy "machinery_delete_own_or_admin"
  on public.machinery for delete
  using (created_by = auth.uid() or public.is_admin(auth.uid()));

-- รูปภาพ: ใช้ bucket 'flood_photos' เดิม (นโยบายอัปโหลด/ดูมีอยู่แล้วจาก schema-v2)
