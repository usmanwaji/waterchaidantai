-- ============================================================================
-- schema-v7.sql — audit_log (บันทึกการกระทำของผู้ดูแลระบบ) สำหรับหน้า admin.html
-- รันใน Supabase: SQL Editor → New query → paste → Run
-- ใช้ helper เดิม is_admin / is_approved (schema.sql)
-- ============================================================================

create table if not exists public.audit_log (
  id          uuid primary key default gen_random_uuid(),
  ts          timestamptz not null default now(),
  actor       uuid references auth.users(id),
  actor_email text,
  action      text not null,   -- 'approve_user' | 'reject_user' | 'delete_user' | 'set_scope' | ...
  target      text,            -- id หรืออีเมลของสิ่งที่ถูกกระทำ
  detail      jsonb
);
comment on table public.audit_log is 'บันทึกการกระทำสำคัญของผู้ดูแล (อนุมัติ/ปฏิเสธ/ลบ/ตั้งขอบเขต) — ตรวจสอบย้อนหลังได้';
create index if not exists audit_log_ts_idx on public.audit_log (ts desc);

alter table public.audit_log enable row level security;

-- อ่านได้เฉพาะแอดมิน
drop policy if exists "audit_select_admin" on public.audit_log;
create policy "audit_select_admin"
  on public.audit_log for select using (public.is_admin(auth.uid()));

-- เขียนได้เฉพาะสมาชิกอนุมัติ (โดยปกติคือแอดมินที่ทำ action) และต้องเป็นเจ้าของ actor
drop policy if exists "audit_insert_approved" on public.audit_log;
create policy "audit_insert_approved"
  on public.audit_log for insert
  with check (public.is_approved(auth.uid()) and actor = auth.uid());
