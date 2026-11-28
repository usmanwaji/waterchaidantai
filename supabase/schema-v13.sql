-- ============================================================================
-- schema-v13.sql — ให้ ffr_publish() รับชุดข้อมูลว่าง (0 หมู่บ้าน)
-- รันใน Supabase: SQL Editor → New query → paste → Run (รันซ้ำได้ ปลอดภัย) · ต้องรัน v12 มาก่อน
--
-- บางรอบตารางของกรมทรัพยากรน้ำไม่มีหมู่บ้านเสี่ยงใน จ.นราธิวาสเลย (มีแต่จังหวัดอื่น)
-- เดิม ffr_publish ปฏิเสธ 0 แถว เว็บจึงค้างข้อมูลรอบเก่าไว้ · ตอนนี้เผยแพร่ชุดว่างได้
-- แล้ว forecast.html แสดงว่าช่วงเวลานั้นไม่มีหมู่บ้านเสี่ยง
-- ============================================================================

create or replace function public.ffr_publish(p_token text, p_period text, p_rows jsonb, p_source text, p_note text default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_n int; v_id bigint;
begin
  if not public._ffr_ok(p_token) then raise exception 'session expired, please log in again' using errcode = '28000'; end if;
  if length(trim(coalesce(p_period, ''))) < 4 then raise exception 'period is required'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'rows must be an array'; end if;
  v_n := jsonb_array_length(p_rows);
  -- 0 แถว = ช่วงนี้ไม่มีหมู่บ้านเสี่ยงใน จ.นราธิวาส (ไฟล์มีแต่จังหวัดอื่น) เผยแพร่ได้ หน้า forecast แสดงว่าไม่มีพื้นที่เสี่ยง
  if v_n > 5000 then raise exception 'row count % out of range', v_n; end if;
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
grant execute on function public.ffr_publish(text, text, jsonb, text, text) to anon, authenticated;
