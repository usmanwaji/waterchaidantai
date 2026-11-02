-- ============================================================================
-- schema-v12.sql — ตารางความเสี่ยงดินโคลนถล่ม (FFR 36 ชม.) ที่เจ้าหน้าที่อัปโหลด
-- รันใน Supabase: SQL Editor → New query → paste → Run (รันซ้ำได้ ปลอดภัย)
--
-- ใช้กับหน้า ffr-upload.html (ไม่มีลิงก์จากหน้าไหนในเว็บ) เจ้าหน้าที่อัปโหลด Excel/PDF
-- "ตารางคาดการณ์หมู่บ้านเสี่ยงภัยน้ำหลากดินถล่ม" ของกรมทรัพยากรน้ำ หน้านั้นแปลงไฟล์ในเบราว์เซอร์
-- แล้วส่งแถวที่แปลงแล้วมาเก็บผ่าน ffr_publish()
-- forecast.html (ปุ่ม ความเสี่ยงดินโคลนถล่ม) อ่านชุดล่าสุดจาก ffr_current แทนไฟล์ js/ffr_risk_data.js
--
-- สิทธิ์อัปโหลดใช้ "รหัสผ่าน" ชุดเดียว ตรวจฝั่งเซิร์ฟเวอร์เท่านั้น
--   • เก็บเฉพาะค่า bcrypt ของรหัสผ่าน · ไม่มีรหัสผ่านในไฟล์นี้หรือในโค้ดหน้าเว็บ (repo เป็นสาธารณะ)
--   • ล็อกอินถูกได้ token อายุ 12 ชม. ใช้กับ ffr_publish / ffr_history / ffr_rollback / ffr_use_builtin
--   • กันเดารหัส: ผิด 10 ครั้งใน 15 นาทีจากเครื่องเดียว หรือ 60 ครั้งใน 15 นาทีรวมทุกเครื่อง → ปิดล็อกอินชั่วคราว
--     (เก็บเฉพาะ sha256 ของ IP ไม่เกิน 1 วัน)
--
-- ตั้ง/เปลี่ยนรหัสผ่าน (รันใน SQL Editor เท่านั้น · อย่า commit รหัสจริงลง repo):
--   select public.ffr_set_password('รหัสผ่าน');
--   เปลี่ยนรหัสแล้ว token เดิมทุกเครื่องหมดอายุทันที
-- ถูกล็อกเพราะมีคนเดารหัส (หน้าเว็บขึ้น "ลองผิดหลายครั้งเกินไป"):
--   delete from public.ffr_login_fail;
-- ============================================================================

create extension if not exists pgcrypto;   -- crypt(), gen_salt(), gen_random_bytes() · Supabase ติดตั้งไว้ใน schema extensions

-- 1. รหัสผ่าน (แถวเดียว) · token ที่ออกให้ · ประวัติล็อกอินผิด
--    ไม่มี policy โดยตั้งใจ anon/authenticated อ่านตารางเหล่านี้ตรง ๆ ไม่ได้
create table if not exists public.ffr_upload_secret (
  id         int primary key default 1 check (id = 1),
  pass_hash  text not null,                 -- bcrypt
  updated_at timestamptz not null default now()
);
alter table public.ffr_upload_secret enable row level security;

create table if not exists public.ffr_sessions (
  token_hash text primary key,              -- sha256 hex ของ token
  expires_at timestamptz not null
);
alter table public.ffr_sessions enable row level security;

create table if not exists public.ffr_login_fail (
  at      timestamptz not null default now(),
  ip_hash text not null
);
alter table public.ffr_login_fail enable row level security;
create index if not exists ffr_login_fail_at_idx on public.ffr_login_fail(at);

-- 2. ประวัติทุกการอัปโหลด (ไว้ย้อนกลับ) — อ่านผ่าน ffr_history() เท่านั้น
create table if not exists public.ffr_versions (
  id          bigint generated always as identity primary key,
  period      text not null,                -- ช่วงเวลาคาดการณ์ เช่น 11 ต.ค. 2569 12.00 น. – 13 ต.ค. 2569 00.00 น.
  rows        jsonb not null,               -- [[อำเภอ, ตำบล, บ้าน, ค่า FFR, ระดับ], ...] รูปแบบเดียวกับ js/ffr_risk_data.js
  row_count   int not null,
  source_name text,                         -- ชื่อไฟล์ที่อัปโหลด
  note        text,
  uploaded_at timestamptz not null default now()
);
alter table public.ffr_versions enable row level security;
create index if not exists ffr_versions_at_idx on public.ffr_versions(uploaded_at desc);

-- 3. ชุดที่ใช้งานอยู่ (แถวเดียว) — เว็บอ่านได้ทุกคน
create table if not exists public.ffr_current (
  id          int primary key default 1 check (id = 1),
  version_id  bigint not null references public.ffr_versions(id),
  period      text not null,
  rows        jsonb not null,
  row_count   int not null,
  source_name text,
  uploaded_at timestamptz not null
);
alter table public.ffr_current enable row level security;
drop policy if exists ffr_current_read on public.ffr_current;
create policy ffr_current_read on public.ffr_current for select to anon, authenticated using (true);
grant select on public.ffr_current to anon, authenticated;

-- ---------------------------------------------------------------------------
-- ตั้งรหัสผ่าน — เรียกได้จาก SQL Editor เท่านั้น
-- ---------------------------------------------------------------------------
create or replace function public.ffr_set_password(p_password text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if length(coalesce(p_password, '')) < 6 then raise exception 'password must be at least 6 characters'; end if;
  insert into public.ffr_upload_secret(id, pass_hash, updated_at)
  values (1, crypt(p_password, gen_salt('bf', 10)), now())
  on conflict (id) do update set pass_hash = excluded.pass_hash, updated_at = excluded.updated_at;
  delete from public.ffr_sessions;
end $$;
revoke all on function public.ffr_set_password(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- ล็อกอิน → {ok:true, token, expires_at} หรือ {ok:false, reason:'wrong'|'locked'|'no_password'}
-- รหัสผิดไม่ raise exception เพื่อให้บันทึกครั้งที่ผิดไว้ได้ (exception จะ rollback การบันทึก)
-- ---------------------------------------------------------------------------
create or replace function public.ffr_login(p_password text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  h jsonb := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
  v_ip text := encode(sha256(convert_to(coalesce(h->>'cf-connecting-ip', h->>'x-real-ip',
                 split_part(h->>'x-forwarded-for', ',', 1), ''), 'UTF8')), 'hex');
  v_hash text; v_token text;
  v_exp timestamptz := now() + interval '12 hours';
begin
  delete from public.ffr_login_fail where at < now() - interval '1 day';
  delete from public.ffr_sessions where expires_at < now();
  if (select count(*) from public.ffr_login_fail where ip_hash = v_ip and at > now() - interval '15 minutes') >= 10
     or (select count(*) from public.ffr_login_fail where at > now() - interval '15 minutes') >= 60 then
    return jsonb_build_object('ok', false, 'reason', 'locked');
  end if;
  select pass_hash into v_hash from public.ffr_upload_secret where id = 1;
  if v_hash is null then return jsonb_build_object('ok', false, 'reason', 'no_password'); end if;
  if crypt(coalesce(p_password, ''), v_hash) <> v_hash then
    insert into public.ffr_login_fail(ip_hash) values (v_ip);
    return jsonb_build_object('ok', false, 'reason', 'wrong');
  end if;
  v_token := encode(gen_random_bytes(32), 'hex');
  insert into public.ffr_sessions(token_hash, expires_at)
  values (encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), v_exp);
  return jsonb_build_object('ok', true, 'token', v_token, 'expires_at', v_exp);
end $$;

create or replace function public._ffr_ok(p_token text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.ffr_sessions
                 where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')
                   and expires_at > now());
$$;
revoke all on function public._ffr_ok(text) from public, anon, authenticated;

-- เปิดหน้าใหม่บนเครื่องเดิม: token ยังใช้ได้ไหม
create or replace function public.ffr_session_ok(p_token text)
returns boolean language sql stable security definer set search_path = public as $$
  select public._ffr_ok(p_token);
$$;

create or replace function public.ffr_logout(p_token text)
returns void language sql security definer set search_path = public as $$
  delete from public.ffr_sessions where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex');
$$;

-- ---------------------------------------------------------------------------
-- เผยแพร่ชุดใหม่ (แทนที่ทั้งชุด) · ตรวจรูปแบบขั้นต่ำฝั่งเซิร์ฟเวอร์
-- ---------------------------------------------------------------------------
create or replace function public.ffr_publish(p_token text, p_period text, p_rows jsonb, p_source text, p_note text default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_n int; v_id bigint;
begin
  if not public._ffr_ok(p_token) then raise exception 'session expired, please log in again' using errcode = '28000'; end if;
  if length(trim(coalesce(p_period, ''))) < 4 then raise exception 'period is required'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'rows must be an array'; end if;
  v_n := jsonb_array_length(p_rows);
  if v_n < 1 or v_n > 5000 then raise exception 'row count % out of range', v_n; end if;
  if pg_column_size(p_rows) > 2000000 then raise exception 'payload too large'; end if;
  -- ทุกแถวต้องเป็น [อำเภอ, ตำบล, บ้าน, ค่า FFR 0–100, 'high'|'mid'|'low'] (case กันไม่ให้อ่านช่องของแถวที่รูปแบบผิด)
  if exists (select 1 from jsonb_array_elements(p_rows) r
             where case
               when jsonb_typeof(r) <> 'array' then true
               when jsonb_array_length(r) <> 5 then true
               when jsonb_typeof(r->0) <> 'string' or jsonb_typeof(r->1) <> 'string' or jsonb_typeof(r->2) <> 'string' then true
               when jsonb_typeof(r->3) <> 'number' then true
               else (r->>3)::float8 not between 0 and 100 or coalesce(r->>4, '') not in ('high', 'mid', 'low')
             end) then
    raise exception 'every row must be [district, subdistrict, village, FFR number, high|mid|low]';
  end if;

  insert into public.ffr_versions(period, rows, row_count, source_name, note)
  values (left(trim(p_period), 200), p_rows, v_n, left(p_source, 200), left(p_note, 500))
  returning id into v_id;

  insert into public.ffr_current(id, version_id, period, rows, row_count, source_name, uploaded_at)
  values (1, v_id, left(trim(p_period), 200), p_rows, v_n, left(p_source, 200), now())
  on conflict (id) do update set version_id = excluded.version_id, period = excluded.period, rows = excluded.rows,
    row_count = excluded.row_count, source_name = excluded.source_name, uploaded_at = excluded.uploaded_at;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- ประวัติการอัปโหลด (ไม่ส่ง rows กลับ เพื่อให้เบา)
-- ---------------------------------------------------------------------------
create or replace function public.ffr_history(p_token text)
returns table(id bigint, period text, row_count int, source_name text, note text, uploaded_at timestamptz, is_current boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public._ffr_ok(p_token) then raise exception 'session expired, please log in again' using errcode = '28000'; end if;
  return query
    select v.id, v.period, v.row_count, v.source_name, v.note, v.uploaded_at,
           coalesce(c.version_id = v.id, false)
    from public.ffr_versions v
    left join public.ffr_current c on c.id = 1
    order by v.uploaded_at desc
    limit 30;
end $$;

-- ---------------------------------------------------------------------------
-- ย้อนกลับไปใช้เวอร์ชันเก่า
-- ---------------------------------------------------------------------------
create or replace function public.ffr_rollback(p_token text, p_version_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare v public.ffr_versions;
begin
  if not public._ffr_ok(p_token) then raise exception 'session expired, please log in again' using errcode = '28000'; end if;
  select * into v from public.ffr_versions where ffr_versions.id = p_version_id;
  if not found then raise exception 'version % not found', p_version_id; end if;
  insert into public.ffr_current(id, version_id, period, rows, row_count, source_name, uploaded_at)
  values (1, v.id, v.period, v.rows, v.row_count, v.source_name, v.uploaded_at)
  on conflict (id) do update set version_id = excluded.version_id, period = excluded.period, rows = excluded.rows,
    row_count = excluded.row_count, source_name = excluded.source_name, uploaded_at = excluded.uploaded_at;
end $$;

-- กลับไปใช้ไฟล์ในเว็บ (js/ffr_risk_data.js) — ลบชุดที่ใช้งานอยู่ ประวัติยังอยู่
create or replace function public.ffr_use_builtin(p_token text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public._ffr_ok(p_token) then raise exception 'session expired, please log in again' using errcode = '28000'; end if;
  delete from public.ffr_current where id = 1;
end $$;

grant execute on function public.ffr_login(text) to anon, authenticated;
grant execute on function public.ffr_session_ok(text) to anon, authenticated;
grant execute on function public.ffr_logout(text) to anon, authenticated;
grant execute on function public.ffr_publish(text, text, jsonb, text, text) to anon, authenticated;
grant execute on function public.ffr_history(text) to anon, authenticated;
grant execute on function public.ffr_rollback(text, bigint) to anon, authenticated;
grant execute on function public.ffr_use_builtin(text) to anon, authenticated;
