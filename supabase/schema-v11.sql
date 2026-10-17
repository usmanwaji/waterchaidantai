-- ============================================================================
-- schema-v11.sql — ข้อมูลแบบสำรวจที่เจ้าหน้าที่อัปโหลด (บ้านพี่เลี้ยง / ที่จอดรถหนีน้ำ)
-- รันใน Supabase: SQL Editor → New query → paste → Run (รันซ้ำได้ ปลอดภัย)
--
-- ใช้กับหน้า staff-upload.html (ไม่มีลิงก์จากหน้าไหนในเว็บ) เจ้าหน้าที่อัปโหลด Excel/PDF
-- หน้านั้นแปลงไฟล์ในเบราว์เซอร์ วางพิกัด แล้วส่งแถวที่แปลงแล้วมาเก็บผ่าน survey_publish()
-- shelter.html อ่านชุดล่าสุดจาก survey_current แทนไฟล์ js/hosts_nwt.js / js/parking_nwt.js
--
-- สิทธิ์อัปโหลดใช้ "รหัสลิงก์" (คีย์ลับที่อยู่ท้ายลิงก์ staff-upload.html#k=...)
--   • เก็บเฉพาะค่า sha256 ของคีย์ ไม่เก็บคีย์จริง
--   • ออกคีย์แยกต่อคน/ต่อหน่วยงานได้ และปิดคีย์ใดคีย์หนึ่งได้โดยไม่กระทบคนอื่น
--   • ทุกการอัปโหลดบันทึกว่าใช้คีย์ไหน (label) และย้อนกลับเวอร์ชันเก่าได้
--
-- ออกคีย์ใหม่ (ตั้งคีย์เองเป็นข้อความสุ่มยาว ๆ อย่างน้อย 24 ตัวอักษร):
--   insert into public.survey_upload_keys(label, key_hash)
--   values ('ชื่อผู้ใช้หรือหน่วยงาน', encode(sha256(convert_to('คีย์ลับ', 'UTF8')), 'hex'));
--   แล้วส่งลิงก์ https://naraflood.com/staff-upload.html#k=คีย์ลับ ให้คนนั้น
-- ปิดคีย์:
--   update public.survey_upload_keys set active = false where label = 'ชื่อผู้ใช้หรือหน่วยงาน';
-- ============================================================================

-- 1. คีย์อัปโหลด — ไม่มี policy โดยตั้งใจ anon/authenticated อ่านตารางนี้ตรง ๆ ไม่ได้
create table if not exists public.survey_upload_keys (
  id         bigint generated always as identity primary key,
  label      text not null,
  key_hash   text not null unique,          -- sha256 hex ของคีย์
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.survey_upload_keys enable row level security;

-- 2. ประวัติทุกการอัปโหลด (ไว้ย้อนกลับ) — ไม่เปิดให้อ่านตรง ๆ อ่านผ่าน survey_history() เท่านั้น
create table if not exists public.survey_versions (
  id          bigint generated always as identity primary key,
  kind        text not null check (kind in ('hosts','parking')),
  rows        jsonb not null,
  row_count   int not null,
  source_name text,                         -- ชื่อไฟล์ที่อัปโหลด
  note        text,
  uploaded_by text,                         -- label ของคีย์ที่ใช้
  uploaded_at timestamptz not null default now()
);
alter table public.survey_versions enable row level security;
create index if not exists survey_versions_kind_idx on public.survey_versions(kind, uploaded_at desc);

-- 3. ชุดที่ใช้งานอยู่ (1 แถวต่อชนิดข้อมูล) — เว็บอ่านได้ทุกคน
create table if not exists public.survey_current (
  kind        text primary key check (kind in ('hosts','parking')),
  version_id  bigint not null references public.survey_versions(id),
  rows        jsonb not null,
  row_count   int not null,
  source_name text,
  uploaded_at timestamptz not null
);
alter table public.survey_current enable row level security;
drop policy if exists survey_current_read on public.survey_current;
create policy survey_current_read on public.survey_current for select to anon, authenticated using (true);
grant select on public.survey_current to anon, authenticated;

-- ---------------------------------------------------------------------------
-- คืน label ของคีย์ (null = คีย์ผิด/ถูกปิด)
-- ---------------------------------------------------------------------------
create or replace function public._survey_key_label(p_key text)
returns text language sql stable security definer set search_path = public as $$
  select label from public.survey_upload_keys
  where active and key_hash = encode(sha256(convert_to(coalesce(p_key,''), 'UTF8')), 'hex')
  limit 1;
$$;
revoke all on function public._survey_key_label(text) from public, anon, authenticated;

create or replace function public.survey_check_key(p_key text)
returns text language sql stable security definer set search_path = public as $$
  select public._survey_key_label(p_key);
$$;

-- ---------------------------------------------------------------------------
-- เผยแพร่ชุดใหม่ (แทนที่ทั้งชุด) · ตรวจรูปแบบขั้นต่ำฝั่งเซิร์ฟเวอร์
-- ---------------------------------------------------------------------------
create or replace function public.survey_publish(p_key text, p_kind text, p_rows jsonb, p_source text, p_note text default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_label text := public._survey_key_label(p_key);
  v_n int; v_id bigint;
begin
  if v_label is null then raise exception 'invalid upload key' using errcode = '28000'; end if;
  if p_kind not in ('hosts','parking') then raise exception 'unknown kind %', p_kind; end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'rows must be an array'; end if;
  v_n := jsonb_array_length(p_rows);
  if v_n < 1 or v_n > 5000 then raise exception 'row count % out of range', v_n; end if;
  if pg_column_size(p_rows) > 3000000 then raise exception 'payload too large'; end if;
  -- ทุกแถวต้องมีพิกัดอยู่ในกรอบจังหวัดนราธิวาส
  if exists (select 1 from jsonb_array_elements(p_rows) r
             where jsonb_typeof(r) <> 'object'
                or jsonb_typeof(r->'lat') <> 'number' or jsonb_typeof(r->'lon') <> 'number'
                or (r->>'lat')::float8 not between 5.6 and 6.8
                or (r->>'lon')::float8 not between 101.2 and 102.2) then
    raise exception 'every row needs lat/lon inside Narathiwat';
  end if;

  insert into public.survey_versions(kind, rows, row_count, source_name, note, uploaded_by)
  values (p_kind, p_rows, v_n, left(p_source, 200), left(p_note, 500), v_label)
  returning id into v_id;

  insert into public.survey_current(kind, version_id, rows, row_count, source_name, uploaded_at)
  values (p_kind, v_id, p_rows, v_n, left(p_source, 200), now())
  on conflict (kind) do update set version_id = excluded.version_id, rows = excluded.rows,
    row_count = excluded.row_count, source_name = excluded.source_name, uploaded_at = excluded.uploaded_at;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- ประวัติการอัปโหลด (ไม่ส่ง rows กลับ เพื่อให้เบา)
-- ---------------------------------------------------------------------------
create or replace function public.survey_history(p_key text, p_kind text)
returns table(id bigint, row_count int, source_name text, note text, uploaded_by text, uploaded_at timestamptz, is_current boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if public._survey_key_label(p_key) is null then raise exception 'invalid upload key' using errcode = '28000'; end if;
  return query
    select v.id, v.row_count, v.source_name, v.note, v.uploaded_by, v.uploaded_at,
           coalesce(c.version_id = v.id, false)
    from public.survey_versions v
    left join public.survey_current c on c.kind = v.kind
    where v.kind = p_kind
    order by v.uploaded_at desc
    limit 30;
end $$;

-- ---------------------------------------------------------------------------
-- ย้อนกลับไปใช้เวอร์ชันเก่า
-- ---------------------------------------------------------------------------
create or replace function public.survey_rollback(p_key text, p_version_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare v public.survey_versions;
begin
  if public._survey_key_label(p_key) is null then raise exception 'invalid upload key' using errcode = '28000'; end if;
  select * into v from public.survey_versions where id = p_version_id;
  if not found then raise exception 'version % not found', p_version_id; end if;
  insert into public.survey_current(kind, version_id, rows, row_count, source_name, uploaded_at)
  values (v.kind, v.id, v.rows, v.row_count, v.source_name, v.uploaded_at)
  on conflict (kind) do update set version_id = excluded.version_id, rows = excluded.rows,
    row_count = excluded.row_count, source_name = excluded.source_name, uploaded_at = excluded.uploaded_at;
end $$;

-- กลับไปใช้ไฟล์ในเว็บ (js/hosts_nwt.js / js/parking_nwt.js) — ลบชุดที่ใช้งานอยู่ ประวัติยังอยู่
create or replace function public.survey_use_builtin(p_key text, p_kind text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public._survey_key_label(p_key) is null then raise exception 'invalid upload key' using errcode = '28000'; end if;
  delete from public.survey_current where kind = p_kind;
end $$;

grant execute on function public.survey_check_key(text) to anon, authenticated;
grant execute on function public.survey_publish(text, text, jsonb, text, text) to anon, authenticated;
grant execute on function public.survey_history(text, text) to anon, authenticated;
grant execute on function public.survey_rollback(text, bigint) to anon, authenticated;
grant execute on function public.survey_use_builtin(text, text) to anon, authenticated;
