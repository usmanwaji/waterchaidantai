-- ============================================================================
-- schema-v6.sql — ศูนย์พักพิง (shelters) · เหตุการณ์ (incidents)
--                 คำขอสนับสนุน (resource_requests) · แจ้งเตือน (alert_rules/alert_log)
--                 + province_scope ให้แอดมินรายจังหวัด
-- รันใน Supabase: Dashboard → SQL Editor → New query → paste → Run
-- ใช้ระบบสมาชิกเดิม (profiles / is_admin / is_approved) และ trigger update_modified_column()
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0) province_scope — จำกัดขอบเขตจังหวัดของสมาชิก/แอดมิน (null = ทุกจังหวัด)
--    ใช้ในหน้า admin/eoc เพื่อกันแอดมินนราธิวาสไปแก้/ลบข้อมูลของสตูล
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists province_scope text;   -- เช่น 'นราธิวาส' · null = ทั้ง 5 จังหวัด

comment on column public.profiles.province_scope is
  'จังหวัดที่สมาชิกรับผิดชอบ (null = ทุกจังหวัด). ใช้กรอง/จำกัดสิทธิ์ในหน้า admin & eoc';

-- helper: uid นี้มีสิทธิ์ในจังหวัด p ไหม (แอดมินที่ไม่กำหนด scope = ทุกจังหวัด)
create or replace function public.can_edit_province(uid uuid, p text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = uid
      and status = 'approved'
      and (province_scope is null or province_scope = p)
  );
$$;

-- ===========================================================================
-- 1) shelters — ศูนย์พักพิงชั่วคราว (รองรับทั้ง 5 จังหวัด + สถานะสด)
--    หมายเหตุ: นราธิวาสมีชุดข้อมูลตั้งต้นฝังใน shelter.html อยู่แล้ว
--    ตารางนี้ใช้เก็บ "สถานะสด" (เปิด/เต็ม/ปิด + ยอดผู้พักพิง) และศูนย์ของจังหวัดอื่น
-- ===========================================================================
create table if not exists public.shelters (
  id            uuid primary key default gen_random_uuid(),
  ext_id        text,                         -- อ้างอิง id ตั้งต้นใน shelter.html (ถ้ามี) เช่น 'NWT-49'
  name          text not null,
  province      text not null,                -- สตูล/สงขลา/ปัตตานี/ยะลา/นราธิวาส
  amphoe        text,
  tambon        text,
  village       text,
  lat           double precision check (lat between -90 and 90),
  lon           double precision check (lon between -180 and 180),
  capacity      int  check (capacity is null or capacity >= 0),   -- ความจุ (คน)
  occupancy     int  not null default 0 check (occupancy >= 0),   -- ผู้พักพิงปัจจุบัน
  status        text not null default 'standby'
                  check (status in ('standby','open','full','closed')),
  facilities    jsonb,                        -- {"power":true,"water":true,"toilet":10,"kitchen":true,"medical":false,"pet":false}
  contact_name  text,
  contact_phone text,
  note          text,
  created_by    uuid references auth.users(id),
  updated_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.shelters is
  'ศูนย์พักพิงชั่วคราว + สถานะสด (เปิด/เต็ม/ปิด, ยอดผู้พักพิง) แสดงบน shelter.html';
create index if not exists shelters_province_idx on public.shelters (province);
create index if not exists shelters_status_idx   on public.shelters (status);
create unique index if not exists shelters_ext_id_idx on public.shelters (ext_id) where ext_id is not null;

drop trigger if exists update_shelters_modtime on public.shelters;
create trigger update_shelters_modtime
  before update on public.shelters
  for each row execute procedure update_modified_column();

alter table public.shelters enable row level security;

-- อ่านได้สาธารณะ: ประชาชนต้องเห็นศูนย์พักพิงได้แม้ไม่ล็อกอิน (ข้อมูลช่วยชีวิต)
drop policy if exists "shelters_select_public" on public.shelters;
create policy "shelters_select_public"
  on public.shelters for select using (true);

-- เพิ่มได้เฉพาะสมาชิกอนุมัติแล้ว และต้องอยู่ในจังหวัดที่ตนรับผิดชอบ
drop policy if exists "shelters_insert_scoped" on public.shelters;
create policy "shelters_insert_scoped"
  on public.shelters for insert
  with check (public.can_edit_province(auth.uid(), province) and created_by = auth.uid());

-- แก้ไข (อัปเดตยอด/สถานะ): สมาชิกในจังหวัดนั้น หรือแอดมิน
drop policy if exists "shelters_update_scoped" on public.shelters;
create policy "shelters_update_scoped"
  on public.shelters for update
  using (public.can_edit_province(auth.uid(), province) or public.is_admin(auth.uid()))
  with check (public.can_edit_province(auth.uid(), province) or public.is_admin(auth.uid()));

-- ลบ: เฉพาะแอดมินในจังหวัดนั้น
drop policy if exists "shelters_delete_admin" on public.shelters;
create policy "shelters_delete_admin"
  on public.shelters for delete
  using (public.is_admin(auth.uid()) and public.can_edit_province(auth.uid(), province));

-- ===========================================================================
-- 2) incidents — บันทึกเหตุการณ์/ข้อสั่งการ (ใช้ใน eoc.html timeline + SITREP)
-- ===========================================================================
create table if not exists public.incidents (
  id          uuid primary key default gen_random_uuid(),
  ts          timestamptz not null default now(),
  province    text,
  type        text,          -- 'station'|'shelter'|'road'|'order'|'other'
  area        text,          -- อำเภอ/ตำบล/จุด
  detail      text not null,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now()
);
comment on table public.incidents is 'ไทม์ไลน์เหตุการณ์/ข้อสั่งการสำหรับ War Room (eoc.html)';
create index if not exists incidents_ts_idx on public.incidents (ts desc);

alter table public.incidents enable row level security;

drop policy if exists "incidents_select_auth" on public.incidents;
create policy "incidents_select_auth"
  on public.incidents for select using (auth.uid() is not null);

drop policy if exists "incidents_insert_approved" on public.incidents;
create policy "incidents_insert_approved"
  on public.incidents for insert
  with check (public.is_approved(auth.uid()) and created_by = auth.uid());

drop policy if exists "incidents_update_own_or_admin" on public.incidents;
create policy "incidents_update_own_or_admin"
  on public.incidents for update
  using (created_by = auth.uid() or public.is_admin(auth.uid()))
  with check (created_by = auth.uid() or public.is_admin(auth.uid()));

drop policy if exists "incidents_delete_own_or_admin" on public.incidents;
create policy "incidents_delete_own_or_admin"
  on public.incidents for delete
  using (created_by = auth.uid() or public.is_admin(auth.uid()));

-- ===========================================================================
-- 3) resource_requests — คำขอสนับสนุนจักรกล (ต่อยอด resources.html เป็นระบบขอ)
-- ===========================================================================
create table if not exists public.resource_requests (
  id            uuid primary key default gen_random_uuid(),
  requester     text not null,            -- หน่วยที่ขอ
  province      text,
  amphoe        text,
  resource_type text not null,            -- ชนิดที่ขอ (boat, pump_long, ...)
  quantity      int not null default 1 check (quantity > 0),
  urgency       text not null default 'normal' check (urgency in ('normal','urgent','critical')),
  status        text not null default 'requested'
                  check (status in ('requested','approved','dispatched','returned','cancelled')),
  note          text,
  contact_phone text,
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
comment on table public.resource_requests is 'คำขอสนับสนุนเครื่องจักร/เรือ พร้อมสถานะ ขอ→อนุมัติ→ส่ง→คืน';
create index if not exists resreq_status_idx on public.resource_requests (status);

drop trigger if exists update_resreq_modtime on public.resource_requests;
create trigger update_resreq_modtime
  before update on public.resource_requests
  for each row execute procedure update_modified_column();

alter table public.resource_requests enable row level security;

drop policy if exists "resreq_select_auth" on public.resource_requests;
create policy "resreq_select_auth"
  on public.resource_requests for select using (auth.uid() is not null);

drop policy if exists "resreq_insert_approved" on public.resource_requests;
create policy "resreq_insert_approved"
  on public.resource_requests for insert
  with check (public.is_approved(auth.uid()) and created_by = auth.uid());

drop policy if exists "resreq_update_approved_or_admin" on public.resource_requests;
create policy "resreq_update_approved_or_admin"
  on public.resource_requests for update
  using (public.is_approved(auth.uid()) or public.is_admin(auth.uid()))
  with check (public.is_approved(auth.uid()) or public.is_admin(auth.uid()));

-- ===========================================================================
-- 4) alert_rules / alert_log — เครื่องยนต์แจ้งเตือน (ใช้กับ edge function notify-water)
-- ===========================================================================
create table if not exists public.alert_rules (
  id           uuid primary key default gen_random_uuid(),
  label        text,                       -- ชื่อกฎอ่านง่าย
  station_code text,                        -- รหัสสถานี · null = ทั้งจังหวัด
  province     text,
  metric       text not null check (metric in ('wl_pct_bank','rain_24h','nowcast_intensity')),
  threshold    numeric not null,           -- เช่น 80 (% ตลิ่ง), 90 (มม.)
  channel      text not null,              -- 'telegram:<chat_id>' | 'line:<group_id>'
  cooldown_min int not null default 180,   -- กันสแปม
  enabled      boolean not null default true,
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
comment on table public.alert_rules is 'กติกาการแจ้งเตือนที่ edge function ตรวจทุก 15 นาที';
create index if not exists alert_rules_enabled_idx on public.alert_rules (enabled);

drop trigger if exists update_alert_rules_modtime on public.alert_rules;
create trigger update_alert_rules_modtime
  before update on public.alert_rules
  for each row execute procedure update_modified_column();

create table if not exists public.alert_log (
  id        uuid primary key default gen_random_uuid(),
  rule_id   uuid references public.alert_rules(id) on delete set null,
  fired_at  timestamptz not null default now(),
  payload   jsonb                          -- {value, message, channel, station}
);
comment on table public.alert_log is 'ประวัติการยิงแจ้งเตือน + ใช้ตรวจ cooldown';
create index if not exists alert_log_rule_time_idx on public.alert_log (rule_id, fired_at desc);

alter table public.alert_rules enable row level security;
alter table public.alert_log   enable row level security;

-- alert_rules: อ่าน/จัดการเฉพาะสมาชิกอนุมัติ (มีข้อมูล channel/chat_id ที่ไม่ควรเปิดสาธารณะ)
drop policy if exists "alert_rules_select_approved" on public.alert_rules;
create policy "alert_rules_select_approved"
  on public.alert_rules for select using (public.is_approved(auth.uid()));

drop policy if exists "alert_rules_write_approved" on public.alert_rules;
create policy "alert_rules_write_approved"
  on public.alert_rules for all
  using (public.is_approved(auth.uid()))
  with check (public.is_approved(auth.uid()));

-- alert_log: สมาชิกอ่านประวัติได้; การเขียนทำโดย edge function (service_role ข้าม RLS)
drop policy if exists "alert_log_select_approved" on public.alert_log;
create policy "alert_log_select_approved"
  on public.alert_log for select using (public.is_approved(auth.uid()));

-- ============================================================================
-- เสร็จ. ขั้นถัดไป:
--   • ตั้ง Edge Function 'notify-water' (supabase/functions/notify-water/index.ts)
--     ให้รันด้วย pg_cron/Scheduler ทุก 15 นาที และตั้ง secret TELEGRAM_BOT_TOKEN
--   • นำเข้าศูนย์พักพิงจังหวัดอื่นลงตาราง shelters เมื่อได้ list จาก ปภ.จังหวัด
-- ============================================================================
