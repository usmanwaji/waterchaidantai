/* js/auth-ui.js — ปุ่ม "เข้าสู่ระบบด้วย Google" บน header ทุกหน้า
 * ต้องโหลดหลัง supabase SDK + js/supabase-client.js:
 *   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"></script>
 *   <script src="js/supabase-client.js?v=2"></script>
 *   <script src="js/auth-ui.js"></script>
 * แสดงผล: ยังไม่ล็อกอิน = ปุ่ม Google · ล็อกอินแล้ว = ชื่อ + สถานะ + ปุ่มออกจากระบบ
 */
'use strict';
(function () {
  // SDK/ไคลเอนต์โหลดไม่สำเร็จ (เช่น ออฟไลน์) — ไม่ต้องแสดงปุ่ม อย่าทำหน้าพัง
  if (!window.supabase || typeof sb === 'undefined' || typeof watchAuthState !== 'function') return;

  var header = document.querySelector('header');
  if (!header) return;

  var st = document.createElement('style');
  st.textContent =
    '#authUi{display:flex;align-items:center;gap:6px}' +
    '.auth-btn{display:inline-flex;align-items:center;gap:7px;background:#fff;color:#3c4043;border:none;border-radius:7px;padding:6px 12px;font-family:inherit;font-size:12.5px;font-weight:600;cursor:pointer;box-shadow:0 1px 2px rgba(0,0,0,.25);white-space:nowrap;touch-action:manipulation}' +
    '.auth-btn:hover{background:#f1f3f4}' +
    '.auth-chip{display:inline-flex;align-items:center;gap:5px;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.18);color:#fff;border-radius:99px;padding:4px 11px;font-size:12px;font-weight:600;white-space:nowrap;max-width:190px;overflow:hidden;text-overflow:ellipsis}' +
    '.auth-out{background:none;border:none;color:rgba(255,255,255,.65);font-family:inherit;font-size:11.5px;cursor:pointer;text-decoration:underline;white-space:nowrap;padding:2px}' +
    '.auth-out:hover{color:#fff}' +
    '@media(max-width:760px){.auth-btn .auth-txt{display:none}.auth-btn{padding:7px 9px}.auth-chip{max-width:110px}}';
  document.head.appendChild(st);

  var wrap = document.createElement('div');
  wrap.id = 'authUi';
  header.appendChild(wrap);

  var G = '<svg width="15" height="15" viewBox="0 0 48 48" aria-hidden="true">' +
    '<path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.3 6.1 29.4 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.7-.4-3.9z"/>' +
    '<path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.3 6.1 29.4 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>' +
    '<path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.4-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/>' +
    '<path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.5l6.2 5.2C36.9 39.2 44 34 44 24c0-1.3-.1-2.7-.4-3.9z"/></svg>';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m];
    });
  }

  function showLogin() {
    wrap.innerHTML = '<button type="button" class="auth-btn" title="เข้าสู่ระบบด้วย Google">' + G +
      '<span class="auth-txt">เข้าสู่ระบบ</span></button>';
    wrap.querySelector('.auth-btn').addEventListener('click', function () {
      signInWithGoogle(window.location.href);
    });
  }

  function showChip(p, badge, title) {
    var name = (p && (p.full_name || p.email) || 'สมาชิก').split('@')[0];
    wrap.innerHTML =
      '<span class="auth-chip" title="' + esc((p && p.email) || '') + ' · ' + esc(title) + '">' +
      badge + ' ' + esc(name) + '</span>' +
      '<button type="button" class="auth-out">ออกจากระบบ</button>';
    wrap.querySelector('.auth-out').addEventListener('click', function () { signOut(); });
  }

  try {
    watchAuthState({
      onSignedOut: function () { showLogin(); },
      onPending:   function (p) { showChip(p, '⏳', 'รออนุมัติจากผู้ดูแลระบบ'); },
      onRejected:  function (p) { showChip(p, '🚫', 'บัญชีถูกปฏิเสธ'); },
      onApproved:  function (p) { showChip(p, '✅', 'สมาชิก (อนุมัติแล้ว)'); },
      onAdmin:     function (p) { showChip(p, '🛡️', 'ผู้ดูแลระบบ'); }
    });
  } catch (e) { /* เงียบ — ปุ่มไม่ขึ้นดีกว่าหน้าพัง */ }
})();
