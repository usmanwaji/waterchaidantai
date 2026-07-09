-- ============================================================================
-- schema-v4.sql — สิทธิ์แก้ไข/ลบหมุด + แอดมินจัดการผู้ใช้
-- รันใน Supabase: Dashboard → SQL Editor → New query → paste → Run
-- ============================================================================

-- 1) ลบหมุด: เดิมลบได้เฉพาะแอดมิน → เปลี่ยนเป็น "เจ้าของหมุด" หรือแอดมิน
--    (สิทธิ์แก้ไข/อัปเดตเป็น own-or-admin อยู่แล้ว ไม่ต้องแก้)
DROP POLICY IF EXISTS "flood_reports_delete_admin" ON public.flood_reports;
DROP POLICY IF EXISTS "flood_reports_delete_own_or_admin" ON public.flood_reports;
CREATE POLICY "flood_reports_delete_own_or_admin"
  ON public.flood_reports FOR DELETE
  USING (created_by = auth.uid() OR public.is_admin(auth.uid()));

-- 2) แอดมินลบผู้ใช้ออกจากระบบได้ (ลบแถวใน profiles)
--    - ลบตัวเองไม่ได้ และลบบัญชีแอดมินด้วยกันไม่ได้ (กันพลาด)
--    - หมายเหตุ: บัญชี Google ใน auth.users ยังอยู่ ถ้าผู้ใช้ sign-in ใหม่
--      ระบบจะสร้าง profile ใหม่เป็นสถานะ "pending" (ต้องรออนุมัติอีกครั้ง)
DROP POLICY IF EXISTS "profiles_delete_admin" ON public.profiles;
CREATE POLICY "profiles_delete_admin"
  ON public.profiles FOR DELETE
  USING (
    public.is_admin(auth.uid())
    AND id <> auth.uid()
    AND role <> 'admin'
  );
