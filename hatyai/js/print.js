/* print.js — ปุ่มพิมพ์เป็น PDF (A4 แนวนอน / landscape)
   ใช้ร่วมกันทุกหน้าของแดชบอร์ด อุทกภัย หาดใหญ่
   แทรก: <script src="js/print.js" defer></script> ก่อน </body>
*/
(function () {
  if (window.__hatyaiPrintInit) return;
  window.__hatyaiPrintInit = true;

  // ---------- 1) สไตล์สำหรับการพิมพ์ (A4 แนวนอน) ----------
  var css = ''
    + '@page { size: A4 landscape; margin: 10mm; }'
    + '@media print {'
    + '  html, body { background:#fff !important; -webkit-print-color-adjust:exact; print-color-adjust:exact; }'
    // ซ่อนองค์ประกอบที่ไม่ต้องการในหน้ากระดาษ
    + '  nav, .navtab, #selbar, header nav, .no-print,'
    + '  #btnPrint, #btnRefresh, button, .btn, .chip,'
    + '  .leaflet-control-container { display:none !important; }'
    // ให้เนื้อหาเต็มความกว้างกระดาษ
    + '  #content, .content, main { width:100% !important; max-width:100% !important; margin:0 !important; }'
    // กันการ์ด/แถวถูกตัดกลางเมื่อขึ้นหน้าใหม่
    + '  .card, .tile, .grid2 > *, table { break-inside:avoid; page-break-inside:avoid; }'
    + '  a { text-decoration:none !important; color:inherit !important; }'
    + '}';
  var style = document.createElement('style');
  style.id = 'print-a4-landscape';
  style.textContent = css;
  document.head.appendChild(style);

  // ---------- 2) ปุ่มพิมพ์แบบลอย ----------
  function addButton() {
    if (document.getElementById('btnPrint')) return;
    var btn = document.createElement('button');
    btn.id = 'btnPrint';
    btn.className = 'no-print';
    btn.type = 'button';
    btn.title = 'พิมพ์เป็น PDF (A4 แนวนอน)';
    btn.setAttribute('aria-label', 'พิมพ์เป็น PDF (A4 แนวนอน)');
    btn.innerHTML = '🖨️ พิมพ์ PDF';
    btn.style.cssText = [
      'position:fixed', 'right:16px', 'bottom:16px', 'z-index:99999',
      'padding:10px 16px', 'border:none', 'border-radius:24px',
      'background:#0b63c4', 'color:#fff', 'font-size:15px', 'font-weight:600',
      'cursor:pointer', 'box-shadow:0 3px 10px rgba(0,0,0,.25)',
      'font-family:inherit'
    ].join(';');
    btn.addEventListener('click', function () { window.print(); });
    document.body.appendChild(btn);
  }

  if (document.body) addButton();
  else document.addEventListener('DOMContentLoaded', addButton);

  // รองรับคีย์ลัด Ctrl/Cmd + P ให้ใช้สไตล์เดียวกันโดยอัตโนมัติ (เบราว์เซอร์จัดการเอง)
})();
