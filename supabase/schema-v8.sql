-- ============================================================================
-- schema-v8.sql — ทะเบียนกลุ่มเปราะบาง (vulnerable_people) สำหรับ people.html
-- ⚠️ ข้อมูลอ่อนไหวสูง (สุขภาพ + PDPA) — เข้มงวดที่สุด:
--    เห็น/แก้ได้เฉพาะ "แอดมินของจังหวัดนั้น" เท่านั้น (ไม่ใช่สมาชิกทั่วไป, ไม่สาธารณะ)
--    เก็บข้อมูลเท่าที่จำเป็น และควรทำข้อตกลง/ประสาน อบต./รพ.สต. ก่อนใช้งานจริง
-- รันใน Supabase: SQL Editor → New query → paste → Run (ต้องรัน schema-v6 ก่อน เพื่อมี province_scope)
-- ============================================================================

-- แอดมินที่มีสิทธิ์ในจังหวัด p (province_scope = null หมายถึงทุกจังหวัด)
create or replace function public.is_admin_for_province(uid uuid, p text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = uid and role = 'admin' and status = 'approved'
      and (province_scope is null or province_scope = p)
  );
$$;

create table if not exists public.vulnerable_people (
  id            uuid primary key default gen_random_uuid(),
  province      text not null,
  amphoe        text,
  tambon        text,
  village       text,
  category      text not null check (category in ('bedridden','elderly','disabled','chronic','pregnant','child','other')),
  full_name     text,               -- ระบุได้ถ้าจำเป็น (PDPA)
  needs         text,               -- ความช่วยเหลือที่ต้องการ เช่น ต้องใช้ออกซิเจน/รถเข็น/เปลหาม
  contact_name  text,
  contact_phone text,
  lat           double precision,
  lon           double precision,
  note          text,
  created_by    uuid references auth.users(id),
  updated_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
comment on table public.vulnerable_people is
  'ทะเบียนกลุ่มเปราะบางเพื่อวางแผนอพยพ — ข้อมูลอ่อนไหว เห็นได้เฉพาะแอดมินจังหวัดนั้น (PDPA)';
create index if not exists vp_province_idx on public.vulnerable_people (province);

drop trigger if exists update_vp_modtime on public.vulnerable_people;
create trigger update_vp_modtime
  before update on public.vulnerable_people
  for each row execute procedure update_modified_column();

alter table public.vulnerable_people enable row level security;

-- อ่าน: เฉพาะแอดมินของจังหวัดนั้น
drop policy if exists "vp_select_admin_prov" on public.vulnerable_people;
create policy "vp_select_admin_prov"
  on public.vulnerable_people for select
  using (public.is_admin_for_province(auth.uid(), province));

-- เพิ่ม: แอดมินของจังหวัดนั้น และต้องเป็นเจ้าของแถว
drop policy if exists "vp_insert_admin_prov" on public.vulnerable_people;
create policy "vp_insert_admin_prov"
  on public.vulnerable_people for insert
  with check (public.is_admin_for_province(auth.uid(), province) and created_by = auth.uid());

-- แก้ไข: แอดมินของจังหวัดนั้น
drop policy if exists "vp_update_admin_prov" on public.vulnerable_people;
create policy "vp_update_admin_prov"
  on public.vulnerable_people for update
  using (public.is_admin_for_province(auth.uid(), province))
  with check (public.is_admin_for_province(auth.uid(), province));

-- ลบ: แอดมินของจังหวัดนั้น
drop policy if exists "vp_delete_admin_prov" on public.vulnerable_people;
create policy "vp_delete_admin_prov"
  on public.vulnerable_people for delete
  using (public.is_admin_for_province(auth.uid(), province));
