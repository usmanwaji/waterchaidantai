
'use strict';
const API = 'https://api-v3.thaiwater.net/api/v1/thaiwater30';
const PROVINCES = [
  {code:'91', name:'สตูล'},
  {code:'90', name:'สงขลา'},
  {code:'94', name:'ปัตตานี'},
  {code:'95', name:'ยะลา'},
  {code:'96', name:'นราธิวาส'}
];
const PROV_SET = new Set(PROVINCES.map(p=>p.name));
const BBOX = {latMin:5.5, latMax:8.0, lonMin:99.1, lonMax:102.3};   // 5 จังหวัดใต้ล่าง (รวมเกาะฝั่งอันดามัน)
const inBbox = (lat,lon)=> lat!=null && lon!=null && lat>=BBOX.latMin && lat<=BBOX.latMax && lon>=BBOX.lonMin && lon<=BBOX.lonMax;

/* ================= ภาษา (TH / EN / MS) ================= */
const STR = {
th:{
  title:'🌊 One Map ระดับน้ำชายแดนใต้', sub:'สตูล · สงขลา · ปัตตานี · ยะลา · นราธิวาส — รวมทุกหน่วยงานในแผนที่เดียว',
  refresh:'รีเฟรช', loading:'กำลังโหลดข้อมูล…', updated:'อัปเดตล่าสุด', partial:'บางแหล่งข้อมูลโหลดไม่สำเร็จ',
  search:'🔍 ค้นหาสถานี / แม่น้ำ / อำเภอ…', all:'ทั้งหมด', listEmpty:'ไม่พบสถานีตามเงื่อนไข',
  lyWL:'⚫ ระดับน้ำ', lyRain:'◼ ฝน 24 ชม.', lyDam:'🔻 เขื่อน', lySea:'🌊 น้ำทะเล', lyCctv:'📷 CCTV', lyTele:'▲ โทรมาตร ชป.', lyRisk:'⚠ จุดเสี่ยงฉับพลัน',
  teleSrc:'กรมชลประทาน', teleProj:'โครงการชลประทาน', teleView:'เปิดระบบโทรมาตร ชป. ↗',
  extDdpm:'📹 CCTV ปภ. ↗', extTelerid:'▲ โทรมาตร ชป. ↗',
  lyDdpm:'📹 CCTV ปภ.', ddpmSrc:'ระบบเฝ้าระวังภัยพิบัติ ปภ.', ddpmCoord:'พิกัด (ละติจูด, ลองจิจูด)',
  ddpmWL:'ระดับน้ำปัจจุบัน (ม.)', ddpmCam:'สถานะกล้อง', camOn:'🟢 ออนไลน์', camOff:'🔴 ออฟไลน์', ddpmTel:'โทรศัพท์',
  ddpmLow:'น้ำน้อย', ddpmMed:'ปานกลาง', ddpmHigh:'น้ำมาก เฝ้าระวัง', ddpmCrit:'วิกฤต',
  ddpmOpen:'📺 ดูข้อมูลต้นทาง cctv.disaster.go.th', ddpmNewTabLbl:'เปิดแท็บใหม่ ↗',
  ddpmModalTitle:'📹 ระบบเฝ้าระวังภัยพิบัติ ปภ. (cctv.disaster.go.th)',
  ddpmNoteTxt:'หากหน้าต่างด้านบนว่างเปล่า แสดงว่าเว็บ ปภ. ไม่อนุญาตให้ฝังหน้า — กด "เปิดแท็บใหม่" แทน',
  report:'📋 คัดลอกรายงานสถานการณ์', copied:'คัดลอกรายงานแล้ว — วางใน LINE/เอกสารได้เลย',
  wl_overflow:'ล้นตลิ่ง', wl_high:'น้ำมาก', wl_normal:'ปกติ', wl_low:'น้ำน้อย', wl_critlow:'น้อยวิกฤต', wl_unknown:'ไม่มีข้อมูล',
  rain_none:'ไม่มีฝน', rain_light:'ฝนเล็กน้อย', rain_mod:'ฝนปานกลาง', rain_heavy:'ฝนหนัก', rain_vheavy:'ฝนหนักมาก',
  dam_over:'เกินความจุ', dam_watch:'น้ำมาก เฝ้าระวัง', dam_much:'น้ำมาก', dam_normal:'ปกติ', dam_low:'น้ำน้อย', nodata:'ไม่มีข้อมูล',
  lv:'ระดับน้ำ (ม.รทก.)', bank:'ระดับตลิ่ง (ม.รทก.)', diffbank:'ห่างจากตลิ่ง (ม.)', flow:'อัตราการไหล (ม³/วิ)', time:'เวลาวัด',
  up:'▲ เพิ่มขึ้น', down:'▼ ลดลง', steady:'▬ ทรงตัว', stale:'⏱ ข้อมูลเก่ากว่า 24 ชม.',
  gcap:'ระดับน้ำ 3 วันย้อนหลัง (เส้นประแดง = ตลิ่ง)', gload:'กำลังโหลดกราฟ…', gfail:'ไม่สามารถโหลดกราฟได้', gnone:'ไม่มีข้อมูลกราฟ',
  full:'ดูข้อมูลเต็มที่ thaiwater.net ↗', damfull:'ดูข้อมูลเขื่อนทั้งหมด ↗', seafull:'ดูระดับน้ำชายฝั่งเต็ม ↗',
  rain24:'ฝนสะสม 24 ชม.', storage:'ปริมาณน้ำ (ล้าน ม³)', inflow:'น้ำไหลเข้า (ล้าน ม³/วัน)', outflow:'ระบายออก (ล้าน ม³/วัน)', damlv:'ระดับน้ำ (ม.รทก.)', damdate:'วันที่ข้อมูล', pctcap:'% รนก.',
  seawarn:'⚠ แจ้งเตือนคลื่นซัดฝั่ง', seanormal:'สถานการณ์ปกติ', seamon:'ระดับเฝ้าระวัง (ม.)', seamodel:'ข้อมูลแบบจำลอง', seasrc:'แบบจำลองคลื่นซัดฝั่ง สสน.',
  cctvView:'📺 เปิดดูภาพสด ↗', cctvNote:'กล้องเพิ่มเติม:', cctvDdpm:'CCTV ปภ.', cctvRid:'โทรมาตร ชป.',
  riskTitle:'จุดเสี่ยงน้ำท่วมฉับพลัน 24 ชม.', riskRain:'ฝนสะสม (มม.)', riskSrc:'ที่มา: สสน. (HII)',
  bannerFF:'⚠️ <b>เฝ้าระวังน้ำท่วมฉับพลัน 24 ชม. ข้างหน้า:</b>', andMore:'และอื่น ๆ',
  legWL:'⚫ ระดับน้ำ (% ความจุลำน้ำ)', legRain:'◼ ฝนสะสม 24 ชม.', legOther:'🔻 เขื่อน · 🌊 น้ำทะเล · 📷 CCTV · ▲ โทรมาตร · ⚠ จุดเสี่ยง',
  legR1:'เล็กน้อย ≤10 มม.', legR2:'ปานกลาง 10–35 มม.', legR3:'หนัก 35–90 มม.', legR4:'หนักมาก >90 มม.',
  src:'แหล่งข้อมูล:', note:'อยู่ระหว่างการทดลองปรับปรุง หากมีข้อเสนอ/แก้ไข ติดต่อผู้พัฒนา <a href="mailto:newusmanwaji@gmail.com">newusmanwaji@gmail.com</a>',
  rpTitle:'📋 รายงานสถานการณ์น้ำ 5 จังหวัดภาคใต้ตอนล่าง', rpStations:'สถานี', rpCrit:'⚠ สถานีเฝ้าระวังเร่งด่วน:', rpNoCrit:'✅ ไม่มีสถานีล้นตลิ่ง/น้ำมาก', rpRainMax:'🌧 ฝนสะสม 24 ชม. สูงสุด:', rpDam:'🔻 เขื่อน/อ่างเก็บน้ำ:', rpRisk:'⚠ พื้นที่เสี่ยงน้ำท่วมฉับพลัน:', rpSrc:'ที่มา: thaiwater.net (สสน.) / HII',
  prov:{'สตูล':'สตูล','สงขลา':'สงขลา','ปัตตานี':'ปัตตานี','ยะลา':'ยะลา','นราธิวาส':'นราธิวาส'},
  help:'❓ วิธีใช้', helpTitle:'❓ วิธีใช้งานแผนที่',
  helpBody:`
  <h4>สัญลักษณ์บนแผนที่</h4>
  ⚫ วงกลม = สถานีวัดระดับน้ำ สีตาม % ความจุลำน้ำ (เขียว ปกติ · เหลือง/น้ำตาล น้ำน้อย · น้ำเงิน น้ำมาก · <b style="color:#dc2626">แดงกะพริบ = ล้นตลิ่ง</b>)<br>
  ◼ สี่เหลี่ยม = ฝนสะสม 24 ชม. · 🔻 เขื่อน/อ่างเก็บน้ำ · 🌊 น้ำทะเลชายฝั่ง · 📷 กล้อง CCTV · ▲ สถานีโทรมาตรกรมชลฯ · ⚠ จุดเสี่ยงน้ำท่วมฉับพลัน (จากโมเดล สสน.)
  <h4>การใช้งาน</h4>
  • คลิกจุดใดก็ได้เพื่อดูรายละเอียด + กราฟระดับน้ำ 3 วันย้อนหลัง (เส้นประแดง = ระดับตลิ่ง)<br>
  • ปุ่มจังหวัดด้านซ้าย = ซูมและกรองรายจังหวัด · ช่องค้นหา = หาสถานี/แม่น้ำ/อำเภอ<br>
  • กดการ์ดสีสรุปด้านบน = กรองเฉพาะสถานะนั้น (กดซ้ำเพื่อยกเลิก)<br>
  • ติ๊ก ☑ เปิด/ปิดชั้นข้อมูลแต่ละประเภทได้<br>
  • ปุ่ม ◀ ข้างแผงรายการ = ซ่อน/แสดงแผง เพื่อดูแผนที่เต็มจอ
  <h4>เครื่องมือสำหรับเจ้าหน้าที่</h4>
  • 📋 คัดลอกรายงานสถานการณ์ = สรุปสถานีวิกฤต/ฝน/เขื่อน พร้อมวางส่ง LINE หรือรายงาน<br>
  • ⏱ ป้ายเหลืองในรายการ = สถานีส่งข้อมูลเก่ากว่า 24 ชม. ใช้วิจารณญาณก่อนอ้างอิง<br>
  • ข้อมูลรีเฟรชอัตโนมัติทุก 10 นาที หรือกดปุ่มรีเฟรชมุมขวาบน
  <h4>แหล่งข้อมูล</h4>
  รวบรวมจาก API สาธารณะ: สสน. (thaiwater.net) · กรมชลประทาน · HII · ลิงก์ CCTV ปภ. และโทรมาตรกรมชลฯ ในหมุดกล้อง`
},
en:{
  title:'🌊 One Map — Southern Border Water Watch', sub:'Satun · Songkhla · Pattani · Yala · Narathiwat — all agencies, one map',
  refresh:'Refresh', loading:'Loading…', updated:'Last updated', partial:'some sources failed to load',
  search:'🔍 Search station / river / district…', all:'All', listEmpty:'No stations match',
  lyWL:'⚫ Water level', lyRain:'◼ Rain 24 h', lyDam:'🔻 Dams', lySea:'🌊 Sea level', lyCctv:'📷 CCTV', lyTele:'▲ RID telemetry', lyRisk:'⚠ Flash-flood risk',
  teleSrc:'Royal Irrigation Dept', teleProj:'Irrigation project', teleView:'Open RID telemetry ↗',
  extDdpm:'📹 DDPM CCTV ↗', extTelerid:'▲ RID telemetry ↗',
  lyDdpm:'📹 DDPM CCTV', ddpmSrc:'DDPM disaster surveillance system', ddpmCoord:'Coordinates (lat, lon)',
  ddpmWL:'Current water level (m)', ddpmCam:'Camera status', camOn:'🟢 Online', camOff:'🔴 Offline', ddpmTel:'Phone',
  ddpmLow:'Low', ddpmMed:'Medium', ddpmHigh:'High — watch', ddpmCrit:'Critical',
  ddpmOpen:'📺 View source at cctv.disaster.go.th', ddpmNewTabLbl:'Open in new tab ↗',
  ddpmModalTitle:'📹 DDPM Disaster Surveillance (cctv.disaster.go.th)',
  ddpmNoteTxt:'If the frame above is blank, the DDPM site blocks embedding — use "Open in new tab" instead.',
  report:'📋 Copy situation report', copied:'Report copied — paste into LINE/documents',
  wl_overflow:'Overflow', wl_high:'High', wl_normal:'Normal', wl_low:'Low', wl_critlow:'Critically low', wl_unknown:'No data',
  rain_none:'No rain', rain_light:'Light rain', rain_mod:'Moderate rain', rain_heavy:'Heavy rain', rain_vheavy:'Very heavy rain',
  dam_over:'Over capacity', dam_watch:'High — watch', dam_much:'High', dam_normal:'Normal', dam_low:'Low', nodata:'No data',
  lv:'Water level (m MSL)', bank:'Bank level (m MSL)', diffbank:'Distance to bank (m)', flow:'Discharge (m³/s)', time:'Measured',
  up:'▲ rising', down:'▼ falling', steady:'▬ steady', stale:'⏱ Data older than 24 h',
  gcap:'Water level, past 3 days (red dash = bank)', gload:'Loading graph…', gfail:'Could not load graph', gnone:'No graph data',
  full:'Full data at thaiwater.net ↗', damfull:'All dam data ↗', seafull:'Full coastal data ↗',
  rain24:'Rain 24 h', storage:'Storage (MCM)', inflow:'Inflow (MCM/day)', outflow:'Released (MCM/day)', damlv:'Level (m MSL)', damdate:'Data date', pctcap:'% capacity',
  seawarn:'⚠ Storm-surge warning', seanormal:'Normal', seamon:'Monitoring level (m)', seamodel:'Model run', seasrc:'HII storm-surge model',
  cctvView:'📺 Open live view ↗', cctvNote:'More cameras:', cctvDdpm:'DDPM CCTV', cctvRid:'RID telemetry',
  riskTitle:'Flash-flood risk, next 24 h', riskRain:'Accum. rain (mm)', riskSrc:'Source: HII',
  bannerFF:'⚠️ <b>Flash-flood watch, next 24 h:</b>', andMore:'and more',
  legWL:'⚫ Water level (% channel capacity)', legRain:'◼ Rain, 24 h', legOther:'🔻 Dam · 🌊 Sea · 📷 CCTV · ▲ Telemetry · ⚠ Risk',
  legR1:'Light ≤10 mm', legR2:'Moderate 10–35 mm', legR3:'Heavy 35–90 mm', legR4:'Very heavy >90 mm',
  src:'Sources:', note:'Trial version under improvement — suggestions/corrections: <a href="mailto:newusmanwaji@gmail.com">newusmanwaji@gmail.com</a>',
  rpTitle:'📋 Water situation report — 5 southern provinces', rpStations:'stations', rpCrit:'⚠ Priority stations:', rpNoCrit:'✅ No overflow/high stations', rpRainMax:'🌧 Max rain 24 h:', rpDam:'🔻 Dams/reservoirs:', rpRisk:'⚠ Flash-flood risk areas:', rpSrc:'Source: thaiwater.net (HII)',
  prov:{'สตูล':'Satun','สงขลา':'Songkhla','ปัตตานี':'Pattani','ยะลา':'Yala','นราธิวาส':'Narathiwat'},
  help:'❓ How to use', helpTitle:'❓ How to use this map',
  helpBody:`
  <h4>Map symbols</h4>
  ⚫ Circle = water-level station, coloured by % of channel capacity (green normal · yellow/brown low · blue high · <b style="color:#dc2626">blinking red = overflowing</b>)<br>
  ◼ Square = 24-h rainfall · 🔻 dam/reservoir · 🌊 coastal sea level · 📷 CCTV · ▲ RID telemetry station · ⚠ flash-flood risk spot (HII model)
  <h4>Using the map</h4>
  • Click any point for details + a 3-day water-level graph (red dash = bank level)<br>
  • Province buttons zoom & filter · search box finds stations/rivers/districts<br>
  • Click a coloured summary card to filter by status (click again to clear)<br>
  • Tick ☑ boxes to toggle each data layer<br>
  • The ◀ button beside the panel hides/shows it for a full-screen map
  <h4>Tools for officials</h4>
  • 📋 Copy situation report = summary of critical stations/rain/dams, ready to paste into LINE<br>
  • ⏱ yellow tag = station data older than 24 h — verify before citing<br>
  • Data auto-refreshes every 10 minutes, or press Refresh
  <h4>Data sources</h4>
  Public APIs: HII (thaiwater.net) · Royal Irrigation Dept · DDPM CCTV & RID telemetry links in camera pins`
},
ms:{
  title:'🌊 One Map — Paras Air Selatan Thai', sub:'Satun · Songkhla · Patani · Yala · Narathiwat — semua agensi, satu peta',
  refresh:'Muat semula', loading:'Memuatkan…', updated:'Kemas kini terakhir', partial:'sebahagian sumber gagal dimuat',
  search:'🔍 Cari stesen / sungai / daerah…', all:'Semua', listEmpty:'Tiada stesen sepadan',
  lyWL:'⚫ Paras air', lyRain:'◼ Hujan 24 j', lyDam:'🔻 Empangan', lySea:'🌊 Paras laut', lyCctv:'📷 CCTV', lyTele:'▲ Telemetri RID', lyRisk:'⚠ Risiko banjir kilat',
  teleSrc:'Jabatan Pengairan', teleProj:'Projek pengairan', teleView:'Buka telemetri RID ↗',
  extDdpm:'📹 CCTV DDPM ↗', extTelerid:'▲ Telemetri RID ↗',
  lyDdpm:'📹 CCTV DDPM', ddpmSrc:'Sistem pemantauan bencana DDPM', ddpmCoord:'Koordinat (lat, lon)',
  ddpmWL:'Paras air semasa (m)', ddpmCam:'Status kamera', camOn:'🟢 Dalam talian', camOff:'🔴 Luar talian', ddpmTel:'Telefon',
  ddpmLow:'Rendah', ddpmMed:'Sederhana', ddpmHigh:'Tinggi — berjaga', ddpmCrit:'Kritikal',
  ddpmOpen:'📺 Lihat sumber di cctv.disaster.go.th', ddpmNewTabLbl:'Buka tab baharu ↗',
  ddpmModalTitle:'📹 Pemantauan Bencana DDPM (cctv.disaster.go.th)',
  ddpmNoteTxt:'Jika bingkai di atas kosong, laman DDPM menyekat pembenaman — guna "Buka tab baharu".',
  report:'📋 Salin laporan situasi', copied:'Laporan disalin — tampal ke LINE/dokumen',
  wl_overflow:'Melimpah tebing', wl_high:'Paras tinggi', wl_normal:'Normal', wl_low:'Paras rendah', wl_critlow:'Kritikal rendah', wl_unknown:'Tiada data',
  rain_none:'Tiada hujan', rain_light:'Hujan ringan', rain_mod:'Hujan sederhana', rain_heavy:'Hujan lebat', rain_vheavy:'Hujan sangat lebat',
  dam_over:'Melebihi kapasiti', dam_watch:'Tinggi — berjaga-jaga', dam_much:'Tinggi', dam_normal:'Normal', dam_low:'Rendah', nodata:'Tiada data',
  lv:'Paras air (m MSL)', bank:'Paras tebing (m MSL)', diffbank:'Jarak ke tebing (m)', flow:'Kadar aliran (m³/s)', time:'Masa cerapan',
  up:'▲ meningkat', down:'▼ menurun', steady:'▬ stabil', stale:'⏱ Data melebihi 24 jam',
  gcap:'Paras air 3 hari lepas (garis merah = tebing)', gload:'Memuatkan graf…', gfail:'Graf tidak dapat dimuat', gnone:'Tiada data graf',
  full:'Data penuh di thaiwater.net ↗', damfull:'Semua data empangan ↗', seafull:'Data pantai penuh ↗',
  rain24:'Hujan 24 jam', storage:'Simpanan (juta m³)', inflow:'Aliran masuk (juta m³/hari)', outflow:'Dilepaskan (juta m³/hari)', damlv:'Paras (m MSL)', damdate:'Tarikh data', pctcap:'% kapasiti',
  seawarn:'⚠ Amaran ombak besar', seanormal:'Normal', seamon:'Paras pemantauan (m)', seamodel:'Larian model', seasrc:'Model ombak HII',
  cctvView:'📺 Buka paparan langsung ↗', cctvNote:'Kamera lain:', cctvDdpm:'CCTV DDPM', cctvRid:'Telemetri RID',
  riskTitle:'Risiko banjir kilat, 24 jam akan datang', riskRain:'Hujan terkumpul (mm)', riskSrc:'Sumber: HII',
  bannerFF:'⚠️ <b>Amaran banjir kilat 24 jam akan datang:</b>', andMore:'dan lain-lain',
  legWL:'⚫ Paras air (% kapasiti sungai)', legRain:'◼ Hujan 24 jam', legOther:'🔻 Empangan · 🌊 Laut · 📷 CCTV · ▲ Telemetri · ⚠ Risiko',
  legR1:'Ringan ≤10 mm', legR2:'Sederhana 10–35 mm', legR3:'Lebat 35–90 mm', legR4:'Sangat lebat >90 mm',
  src:'Sumber:', note:'Versi percubaan dalam penambahbaikan — cadangan/pembetulan: <a href="mailto:newusmanwaji@gmail.com">newusmanwaji@gmail.com</a>',
  rpTitle:'📋 Laporan situasi air — 5 wilayah selatan', rpStations:'stesen', rpCrit:'⚠ Stesen keutamaan:', rpNoCrit:'✅ Tiada stesen melimpah/tinggi', rpRainMax:'🌧 Hujan 24 j tertinggi:', rpDam:'🔻 Empangan:', rpRisk:'⚠ Kawasan risiko banjir kilat:', rpSrc:'Sumber: thaiwater.net (HII)',
  prov:{'สตูล':'Satun','สงขลา':'Songkhla','ปัตตานี':'Patani','ยะลา':'Yala','นราธิวาส':'Narathiwat'},
  help:'❓ Panduan', helpTitle:'❓ Cara guna peta ini',
  helpBody:`
  <h4>Simbol peta</h4>
  ⚫ Bulatan = stesen paras air, warna ikut % kapasiti sungai (hijau normal · kuning/perang rendah · biru tinggi · <b style="color:#dc2626">merah berkelip = melimpah tebing</b>)<br>
  ◼ Petak = hujan 24 jam · 🔻 empangan · 🌊 paras laut pantai · 📷 CCTV · ▲ stesen telemetri RID · ⚠ titik risiko banjir kilat (model HII)
  <h4>Cara guna</h4>
  • Klik mana-mana titik untuk butiran + graf paras air 3 hari (garis merah = paras tebing)<br>
  • Butang wilayah = zum & tapis · kotak carian = cari stesen/sungai/daerah<br>
  • Klik kad ringkasan berwarna untuk tapis ikut status (klik lagi untuk batal)<br>
  • Tanda ☑ untuk buka/tutup setiap lapisan data<br>
  • Butang ◀ di tepi panel menyorok/memapar panel untuk peta penuh
  <h4>Alat untuk pegawai</h4>
  • 📋 Salin laporan situasi = ringkasan stesen kritikal/hujan/empangan, sedia tampal ke LINE<br>
  • ⏱ tag kuning = data stesen melebihi 24 jam — sahkan sebelum rujuk<br>
  • Data dimuat semula automatik setiap 10 minit
  <h4>Sumber data</h4>
  API awam: HII (thaiwater.net) · Jabatan Pengairan Diraja · pautan CCTV DDPM & telemetri RID dalam pin kamera`
}};
let lang = 'th';
try{ lang = localStorage.getItem('onemap_lang') || 'th'; }catch(e){}
if(!STR[lang]) lang = 'th';
const t = k => STR[lang][k] ?? STR.th[k] ?? k;
const tProv = p => STR[lang].prov[p] || p;
const locale = () => lang==='th' ? 'th-TH' : 'en-GB';

/* ================= เกณฑ์สถานะ ================= */
const WL_CLASSES = {
  overflow:{color:'#dc2626', order:0},
  high:    {color:'#2563eb', order:1},
  normal:  {color:'#22c55e', order:2},
  low:     {color:'#eab308', order:3},
  critlow: {color:'#b45309', order:4},
  unknown: {color:'#9ca3af', order:5}
};
const wlLabel = cls => t('wl_'+cls);
function wlClass(pct){
  if(pct==null || isNaN(pct)) return 'unknown';
  if(pct>100) return 'overflow';
  if(pct>=70) return 'high';
  if(pct>=30) return 'normal';
  if(pct>=10) return 'low';
  return 'critlow';
}
function rainInfo(mm){
  if(mm==null || isNaN(mm) || mm<=0) return {label:t('rain_none'), color:'#94a3b8'};
  if(mm<=10)  return {label:t('rain_light'), color:'#4ade80'};
  if(mm<=35)  return {label:t('rain_mod'), color:'#0ea5e9'};
  if(mm<=90)  return {label:t('rain_heavy'), color:'#f97316'};
  return {label:t('rain_vheavy'), color:'#dc2626'};
}
function damInfo(pct){
  if(pct==null || isNaN(pct)) return {label:t('nodata'), color:'#9ca3af'};
  if(pct>=100) return {label:t('dam_over'), color:'#dc2626'};
  if(pct>=80)  return {label:t('dam_watch'), color:'#f97316'};
  if(pct>=50)  return {label:t('dam_much'), color:'#2563eb'};
  if(pct>=30)  return {label:t('dam_normal'), color:'#22c55e'};
  return {label:t('dam_low'), color:'#eab308'};
}

const num = v => { const n = parseFloat(v); return isNaN(n) ? null : n; };
const esc = s => String(s??'').replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const thName = o => (o && typeof o==='object') ? (o.th || o.en || '') : (o || '');
const fmt = (v,d=2) => v==null ? '—' : v.toLocaleString(locale(),{minimumFractionDigits:d,maximumFractionDigits:d});
function isStale(dtStr){          // dt รูปแบบ "2026-07-03 18:30" (เวลาไทย)
  if(!dtStr) return false;
  const d = new Date(dtStr.replace(' ','T')+'+07:00');
  return !isNaN(d) && (Date.now()-d.getTime()) > 24*3600*1000;
}

async function fetchJSON(url, timeout=25000){
  const ctrl = new AbortController();
  const tm = setTimeout(()=>ctrl.abort(), timeout);
  try{
    const r = await fetch(url, {signal:ctrl.signal, headers:{'Accept':'application/json'}});
    if(!r.ok) throw new Error('HTTP '+r.status);
    return await r.json();
  } finally { clearTimeout(tm); }
}

/* ================= แผนที่ ================= */
const map = L.map('map', {zoomControl:false}).setView([6.20, 101.75], 10);
L.control.zoom({position:'topright'}).addTo(map);
L.control.scale({imperial:false, position:'bottomright'}).addTo(map);
map.createPane('bnd'); map.getPane('bnd').style.zIndex = 350;   // ขอบจังหวัดอยู่ใต้ marker
const baseOSM = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom:18, attribution:'© OpenStreetMap | สสน./สทนช./ชป./HII'
}).addTo(map);
const baseSat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
  maxZoom:18, attribution:'© Esri | สสน./สทนช./ชป./HII'
});
L.control.layers({'แผนที่ถนน / Road':baseOSM,'ดาวเทียม / Satellite':baseSat}, null, {position:'topright'}).addTo(map);

// ค่า default: แสดงเฉพาะชั้น "ระดับน้ำ" เท่านั้น ส่วนชั้นอื่น (ฝน/เขื่อน/น้ำทะเล/CCTV/โทรมาตร/จุดเสี่ยง) ผู้ใช้กดติ๊กเปิดเองทีหลัง
const gWL=L.layerGroup().addTo(map), gRain=L.layerGroup(),
      gDam=L.layerGroup(), gSea=L.layerGroup(),
      gCctv=L.layerGroup(), gDdpm=L.layerGroup().addTo(map), gTele=L.layerGroup(),
      gRisk=L.layerGroup(), gBnd=L.layerGroup().addTo(map);
[['lyWL',gWL],['lyRain',gRain],['lyDam',gDam],['lySea',gSea],['lyCctv',gCctv],['lyDdpm',gDdpm],['lyTele',gTele],['lyRisk',gRisk]].forEach(([id,g])=>{
  const cb = document.getElementById(id);
  cb.checked = map.hasLayer(g);                       // สถานะติ๊กตรงกับแผนที่เสมอ
  cb.onchange = e => e.target.checked ? map.addLayer(g) : map.removeLayer(g);
});

/* ---------- ปุ่มลัดบนแผนที่: ใกล้ฉัน · เฉพาะผิดปกติ · แชร์สรุป ---------- */
(function(){
  const st=document.createElement('style');
  st.textContent='.maptools{display:flex;flex-direction:column;gap:4px}.maptools button{width:34px;height:34px;border:none;border-radius:8px;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.28);font-size:16px;cursor:pointer;line-height:1}.maptools button.on{background:#fe6e00;color:#fff}';
  document.head.appendChild(st);
})();
let wlFilterAbnormal=false, meMarker=null;
const toolCtl=L.control({position:'topleft'});
toolCtl.onAdd=()=>{ const d=L.DomUtil.create('div','maptools');
  d.innerHTML='<button id="btnNear" title="ใกล้ฉัน">📍</button><button id="btnAbn" title="เฉพาะสถานีผิดปกติ">⚠</button><button id="btnShare" title="แชร์สรุปสถานการณ์">📷</button>';
  L.DomEvent.disableClickPropagation(d); return d; };
toolCtl.addTo(map);
document.getElementById('btnNear').onclick=locateMe;
document.getElementById('btnAbn').onclick=toggleAbnormal;
document.getElementById('btnShare').onclick=shareSnapshot;

function locateMe(){
  if(!navigator.geolocation){ alert('อุปกรณ์ไม่รองรับการหาตำแหน่ง'); return; }
  const b=document.getElementById('btnNear'); b.textContent='⏳';
  navigator.geolocation.getCurrentPosition(p=>{
    b.textContent='📍'; const ll=[p.coords.latitude,p.coords.longitude];
    if(meMarker) map.removeLayer(meMarker);
    meMarker=L.circleMarker(ll,{radius:9,color:'#2563eb',weight:3,fillColor:'#3b82f6',fillOpacity:.9}).addTo(map).bindPopup('ตำแหน่งของคุณ').openPopup();
    map.setView(ll,12,{animate:true});
  }, e=>{ b.textContent='📍'; alert('หาตำแหน่งไม่ได้: '+e.message); }, {enableHighAccuracy:true,timeout:10000});
}
function toggleAbnormal(){
  wlFilterAbnormal=!wlFilterAbnormal;
  document.getElementById('btnAbn').classList.toggle('on',wlFilterAbnormal);
  if(wlFilterAbnormal && !map.hasLayer(gWL)){ map.addLayer(gWL); const cb=document.getElementById('lyWL'); if(cb)cb.checked=true; }
  applyWlFilter();
}
function applyWlFilter(){
  wlStations.forEach(s=>{ const m=markersById[s.id]; if(!m) return;
    const show=!wlFilterAbnormal || s.cls==='overflow' || s.cls==='high';
    if(show){ if(!gWL.hasLayer(m)) m.addTo(gWL); } else if(gWL.hasLayer(m)) gWL.removeLayer(m); });
}
function shareSnapshot(){
  const over=wlStations.filter(s=>s.cls==='overflow'), high=wlStations.filter(s=>s.cls==='high');
  const top=[...over,...high].sort((a,b)=>(b.pct??-1)-(a.pct??-1)).slice(0,6);
  const W=720,H=210+top.length*28+40, c=document.createElement('canvas'); c.width=W; c.height=H;
  const x=c.getContext('2d');
  x.fillStyle='#0f172a'; x.fillRect(0,0,W,H);
  x.fillStyle='#fb923c'; x.fillRect(0,0,W,60);
  x.fillStyle='#fff'; x.font='bold 23px sans-serif'; x.fillText('🌊 สรุปสถานการณ์น้ำ ชายแดนใต้', 20, 39);
  x.font='13px sans-serif'; x.fillStyle='#94a3b8';
  x.fillText('ณ '+new Date().toLocaleString('th-TH',{dateStyle:'medium',timeStyle:'short'}), 20, 84);
  x.font='bold 38px sans-serif'; x.fillStyle='#f87171'; x.fillText(String(over.length), 40, 142);
  x.fillStyle='#fbbf24'; x.fillText(String(high.length), 240, 142);
  x.font='13px sans-serif'; x.fillStyle='#cbd5e1';
  x.fillText('สถานีล้นตลิ่ง', 40, 166); x.fillText('เฝ้าระวังสูง (≥70%)', 240, 166);
  let yy=208; x.font='14px sans-serif';
  top.forEach(s=>{ x.fillStyle=(WL_CLASSES[s.cls]||{color:'#888'}).color; x.fillRect(20,yy-12,10,10);
    x.fillStyle='#e2e8f0'; x.fillText(`${s.code||''} ${s.name} (อ.${s.amphoe}) ${s.pct!=null?Math.round(s.pct)+'%':''}`.slice(0,58), 38, yy); yy+=28; });
  x.fillStyle='#64748b'; x.font='12px sans-serif'; x.fillText('waterchaidantai.com/map.html', 20, H-14);
  c.toBlob(b=>{ if(!b){ alert('สร้างภาพไม่สำเร็จ'); return; }
    const f=new File([b],'situation.png',{type:'image/png'});
    if(navigator.canShare && navigator.canShare({files:[f]})){ navigator.share({files:[f],title:'สรุปสถานการณ์น้ำ',text:'สรุปสถานการณ์น้ำ ชายแดนใต้'}).catch(()=>{}); }
    else { const a=document.createElement('a'); a.href=URL.createObjectURL(b); a.download='situation.png'; a.click(); }
  });
}

function mkIcon(cls, color, size, text, blink){
  return L.divIcon({
    className:'',
    html:`<div class="mk ${cls} ${blink?'blink':''}" style="width:${size}px;height:${size}px;background:${color};font-size:${Math.round(size*0.42)}px"><span>${text||''}</span></div>`,
    iconSize:[size,size], iconAnchor:[size/2,size/2]
  });
}

/* ---------- คำอธิบายสัญลักษณ์ ---------- */
let legendCtl = null;
function buildLegend(){
  if(legendCtl) map.removeControl(legendCtl);
  legendCtl = L.control({position:'bottomleft'});
  legendCtl.onAdd = () => {
    const d = L.DomUtil.create('div','legend');
    d.innerHTML = `
      <h4>${t('legWL')}</h4>
      ${['overflow','high','normal','low','critlow'].map(k=>`<div class="lg"><span class="sw" style="background:${WL_CLASSES[k].color}"></span>${wlLabel(k)}</div>`).join('')}
      <h4>${t('legRain')}</h4>
      <div class="lg"><span class="sw sq" style="background:#4ade80"></span>${t('legR1')}</div>
      <div class="lg"><span class="sw sq" style="background:#0ea5e9"></span>${t('legR2')}</div>
      <div class="lg"><span class="sw sq" style="background:#f97316"></span>${t('legR3')}</div>
      <div class="lg"><span class="sw sq" style="background:#dc2626"></span>${t('legR4')}</div>
      <h4>${t('legOther')}</h4>`;
    return d;
  };
  legendCtl.addTo(map);
}

/* ---------- สถานะรวม ---------- */
let wlStations = [], rainSpots = [], damList = [], riskAreas = [];
let markersById = {};
let filterProv = 'นราธิวาส';
let filterClass = null;
let lastGraphReq = 0;
/* ================= โหลดข้อมูลทั้งหมด ================= */
async function loadAll(){
  const btn = document.getElementById('btnRefresh');
  btn.classList.add('loading'); btn.disabled = true;
  document.getElementById('updated').textContent = t('loading');
  const results = await Promise.allSettled([loadWaterLevel(), loadRain(), loadDam(), loadSea(), loadCctv(), loadDdpm(), loadTelerid(), loadFlashFlood()]);
  const fails = results.filter(r=>r.status==='rejected').length;
  const now = new Date().toLocaleString(locale(),{dateStyle:'medium', timeStyle:'short'});
  document.getElementById('updated').innerHTML =
    `${t('updated')} ${now}` + (fails ? `<br><span style="color:#fde047">⚠ ${t('partial')} (${fails})</span>` : '');
  btn.classList.remove('loading'); btn.disabled = false;
}

/* ---------- 1) ระดับน้ำ ---------- */
async function loadWaterLevel(){
  const res = await Promise.allSettled(
    PROVINCES.map(p => fetchJSON(`${API}/public/waterlevel?province_code=${p.code}`))
  );
  const rows = [];
  res.forEach(r => { if(r.status==='fulfilled' && Array.isArray(r.value?.data)) rows.push(...r.value.data); });
  if(!rows.length) throw new Error('no wl data');

  gWL.clearLayers(); markersById = {}; wlStations = [];
  rows.forEach(d => {
    const st = d.station || {};
    const lat = num(st.tele_station_lat), lon = num(st.tele_station_long);
    if(lat==null || lon==null) return;
    const pct = num(d.storage_percent);
    const cls = wlClass(pct);
    const C = WL_CLASSES[cls];
    const s = {
      id: 'wl'+(st.id ?? Math.random()),
      stationId: st.id,
      stationType: d.station_type || 'tele_waterlevel',
      name: thName(st.tele_station_name).trim(),
      code: st.tele_station_oldcode || '',
      river: d.river_name || thName(d.basin?.basin_name),
      amphoe: thName(d.geocode?.amphoe_name),
      prov: thName(d.geocode?.province_name),
      agency: thName(d.agency?.agency_shortname),
      dt: d.waterlevel_datetime || '',
      msl: num(d.waterlevel_msl),
      prev: num(d.waterlevel_msl_previous),
      bank: num(st.min_bank),
      diff: num(d.diff_wl_bank),
      diffText: d.diff_wl_bank_text || '',
      discharge: num(d.discharge),
      pct, cls, lat, lon
    };
    const size = (cls==='overflow'||cls==='high') ? 22 : 16;
    const m = L.marker([lat,lon], {icon: mkIcon('mk-wl', C.color, size, '', cls==='overflow'), zIndexOffset:(5-C.order)*100})
      .bindPopup(()=>wlPopup(s), {maxWidth:300});
    m._sid = s.id;
    m.addTo(gWL);
    markersById[s.id] = m;
    wlStations.push(s);
  });
  renderSidebar();
  if(typeof applyWlFilter==='function') applyWlFilter();
}

function trendArrow(s){
  if(s.msl==null || s.prev==null) return '';
  const d = s.msl - s.prev;
  if(d > 0.01)  return ` <span style="color:#dc2626">${t('up')}</span>`;
  if(d < -0.01) return ` <span style="color:#16a34a">${t('down')}</span>`;
  return ` <span style="color:#64748b">${t('steady')}</span>`;
}

function wlPopup(s){
  const C = WL_CLASSES[s.cls];
  return `
  <div class="pp-title">⚫ ${esc(s.name)} ${s.code?`(${esc(s.code)})`:''}</div>
  <div class="pp-sub">${esc(s.river||'')} · ${esc(s.amphoe)} · ${tProv(s.prov)} · ${esc(s.agency)}</div>
  <div class="pp-status"><span class="badge" style="background:${C.color};font-size:12px;padding:3px 14px">${wlLabel(s.cls)}${s.pct!=null?` · ${fmt(s.pct,1)}%`:''}</span></div>
  ${isStale(s.dt)?`<div class="pp-stale">${t('stale')}</div>`:''}
  <dl class="pp-grid">
    <dt>${t('lv')}</dt><dd>${fmt(s.msl)}${trendArrow(s)}</dd>
    <dt>${t('bank')}</dt><dd>${fmt(s.bank)}</dd>
    <dt>${lang==='th' ? esc(s.diffText||t('diffbank')) : t('diffbank')}</dt><dd>${fmt(s.diff)}</dd>
    ${s.discharge!=null?`<dt>${t('flow')}</dt><dd>${fmt(s.discharge)}</dd>`:''}
    <dt>${t('time')}</dt><dd>${esc(s.dt)}</dd>
  </dl>
  <div class="sparkwrap">
    <canvas id="spark-${s.id}" width="260" height="82"></canvas>
    <div class="cap" id="sparkcap-${s.id}">${t('gload')}</div>
  </div>
  <a class="pp-link" href="https://www.thaiwater.net/water/wl" target="_blank">${t('full')}</a>
  ${/ชป|RID/.test(s.agency)?`<a class="pp-link" href="https://telerid.rid.go.th/#/" target="_blank">${t('teleView')}</a>`:''}`;
}

/* ---------- กราฟย้อนหลังใน popup ---------- */
async function onPopupOpen(e){
  const sid = e.popup._source?._sid;
  const s = wlStations.find(x=>x.id===sid);
  if(!s || !s.stationId) return;
  const reqId = ++lastGraphReq;
  const cv = document.getElementById('spark-'+s.id);
  const cap = document.getElementById('sparkcap-'+s.id);
  if(!cv) return;
  try{
    const end = new Date(), start = new Date(end.getTime()-3*86400000);
    const f = d => d.toISOString().slice(0,10);
    const g = await fetchJSON(`${API}/public/waterlevel_graph?station_type=${encodeURIComponent(s.stationType)}&station_id=${s.stationId}&start_date=${f(start)}&end_date=${f(end)}`);
    if(reqId !== lastGraphReq) return;
    const arr = (g?.data?.graph_data || []).map(p=>({t:p.datetime, v:num(p.value)}));
    const bank = num(g?.data?.min_bank) ?? s.bank;
    drawSpark(cv, arr, bank);
    if(cap) cap.textContent = t('gcap');
  }catch(err){
    if(cap) cap.textContent = t('gfail');
  }
}
map.on('popupopen', onPopupOpen);

function drawSpark(cv, arr, bank){
  const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height, padL = 34, padB = 4, padT = 8;
  ctx.clearRect(0,0,W,H);
  const pts = arr.filter(p=>p.v!=null);
  if(pts.length < 2){ ctx.fillStyle='#94a3b8'; ctx.font='11px sans-serif'; ctx.fillText(t('gnone'), padL, H/2); return; }
  let vmin = Math.min(...pts.map(p=>p.v)), vmax = Math.max(...pts.map(p=>p.v));
  if(bank!=null){ vmin = Math.min(vmin, bank); vmax = Math.max(vmax, bank); }
  const range = (vmax-vmin) || 1; vmin -= range*0.08; vmax += range*0.08;
  const X = i => padL + (W-padL-4) * i/(arr.length-1);
  const Y = v => padT + (H-padT-padB-12) * (1 - (v-vmin)/(vmax-vmin));
  ctx.strokeStyle='#e2e8f0'; ctx.beginPath(); ctx.moveTo(padL,padT); ctx.lineTo(padL,H-padB-12); ctx.lineTo(W-4,H-padB-12); ctx.stroke();
  ctx.fillStyle='#64748b'; ctx.font='9px sans-serif';
  ctx.fillText(vmax.toFixed(1), 2, padT+8); ctx.fillText(vmin.toFixed(1), 2, H-padB-12);
  if(bank!=null && bank>=vmin && bank<=vmax){
    ctx.strokeStyle='#dc2626'; ctx.setLineDash([4,3]); ctx.beginPath();
    ctx.moveTo(padL, Y(bank)); ctx.lineTo(W-4, Y(bank)); ctx.stroke(); ctx.setLineDash([]);
  }
  ctx.strokeStyle='#0369a1'; ctx.lineWidth=1.6; ctx.beginPath();   // เส้นน้ำคงสีน้ำเงินตามความหมาย
  let started=false;
  arr.forEach((p,i)=>{
    if(p.v==null){ started=false; return; }
    if(!started){ ctx.moveTo(X(i),Y(p.v)); started=true; } else ctx.lineTo(X(i),Y(p.v));
  });
  ctx.stroke();
}
/* ---------- 2) ฝนสะสม 24 ชม. ---------- */
async function loadRain(){
  const res = await Promise.allSettled(
    PROVINCES.map(p => fetchJSON(`${API}/public/rain_24h?province_code=${p.code}`))
  );
  const rows = [];
  res.forEach(r => { if(r.status==='fulfilled' && Array.isArray(r.value?.data)) rows.push(...r.value.data); });
  gRain.clearLayers(); rainSpots = [];
  if(!rows.length) throw new Error('no rain data');
  rows.forEach(d => {
    const st = d.station || {};
    const lat = num(st.tele_station_lat), lon = num(st.tele_station_long);
    if(lat==null || lon==null) return;
    const mm = num(d.rain_24h);
    if(mm==null || mm<=0) return;
    const spot = {mm, name:thName(st.tele_station_name), amphoe:thName(d.geocode?.amphoe_name), prov:thName(d.geocode?.province_name), dt:d.rainfall_datetime||''};
    rainSpots.push(spot);
    const R = rainInfo(mm);
    const size = mm>90 ? 22 : mm>35 ? 19 : 14;
    L.marker([lat,lon], {icon: mkIcon('mk-rain', R.color, size, '', mm>90), zIndexOffset:-50})
      .bindPopup(()=>`
        <div class="pp-title">◼ ${esc(spot.name)}</div>
        <div class="pp-sub">${esc(spot.amphoe)} · ${tProv(spot.prov)} · ${esc(thName(d.agency?.agency_shortname))}</div>
        <div class="pp-status"><span class="badge" style="background:${rainInfo(mm).color};font-size:12px;padding:3px 14px">${rainInfo(mm).label}</span></div>
        <dl class="pp-grid">
          <dt>${t('rain24')}</dt><dd>${fmt(mm,1)} mm</dd>
          <dt>${t('time')}</dt><dd>${esc(spot.dt)}</dd>
        </dl>`, {maxWidth:280})
      .addTo(gRain);
  });
}

/* ---------- 3) เขื่อน / อ่างเก็บน้ำ ---------- */
const DAM_FALLBACK_COORDS = { 'บางลาง': [6.1608, 101.2724] };
async function loadDam(){
  const g = await fetchJSON(`${API}/analyst/dam`);
  gDam.clearLayers(); damList = [];
  const rows = [
    ...(Array.isArray(g?.data?.dam_hourly) ? g.data.dam_hourly : []),
    ...(Array.isArray(g?.data?.dam_medium) ? g.data.dam_medium : []),
    ...(Array.isArray(g?.data) ? g.data : [])
  ];
  if(!rows.length) throw new Error('no dam data');
  rows.forEach(d => {
    const meta = (d.dam && typeof d.dam==='object') ? d.dam : d;
    const geo = d.geocode || meta.geocode || {};
    const name = thName(meta.dam_name).trim();
    if(!name) return;
    const provCode = String(geo.province_code ?? '');
    let lat = num(meta.dam_lat ?? d.dam_lat), lon = num(meta.dam_long ?? meta.dam_lon ?? d.dam_long);
    const inArea = ['90','91','94','95','96'].includes(provCode)
      || PROV_SET.has(thName(geo.province_name))
      || Object.keys(DAM_FALLBACK_COORDS).some(k=>name.includes(k))
      || inBbox(lat,lon);
    if(!inArea) return;
    if(lat==null || lon==null){
      const k = Object.keys(DAM_FALLBACK_COORDS).find(k=>name.includes(k));
      if(!k) return;
      [lat,lon] = DAM_FALLBACK_COORDS[k];
    }
    const pct = num(d.dam_storage_percent);
    damList.push({name, pct});
    L.marker([lat,lon], {icon: mkIcon('mk-dam', damInfo(pct).color, 24, '▼', pct!=null&&pct>=100), zIndexOffset:200})
      .bindPopup(()=>{
        const D = damInfo(pct);
        return `
        <div class="pp-title">🔻 ${esc(name)}</div>
        <div class="pp-sub">${tProv(thName(geo.province_name))||''} · ${esc(thName(d.agency?.agency_shortname))}</div>
        <div class="pp-status"><span class="badge" style="background:${D.color};font-size:12px;padding:3px 14px">${D.label}${pct!=null?` · ${fmt(pct,1)}${t('pctcap')}`:''}</span></div>
        <dl class="pp-grid">
          <dt>${t('storage')}</dt><dd>${fmt(num(d.dam_storage),1)}</dd>
          <dt>${t('inflow')}</dt><dd>${fmt(num(d.dam_inflow))}</dd>
          <dt>${t('outflow')}</dt><dd>${fmt(num(d.dam_released))}</dd>
          <dt>${t('damlv')}</dt><dd>${fmt(num(d.dam_level))}</dd>
          <dt>${t('damdate')}</dt><dd>${esc(d.dam_date||'')}</dd>
        </dl>
        <a class="pp-link" href="https://www.thaiwater.net/water/dam" target="_blank">${t('damfull')}</a>`;
      }, {maxWidth:290})
      .addTo(gDam);
  });
}

/* ---------- 4) ระดับน้ำทะเลชายฝั่ง ---------- */
async function loadSea(){
  const g = await fetchJSON('https://api.hii.or.th/tiservice/v1/ws/cEniGCuZcTBSa3xj4A8PY187BhpExTfE/model/stromsurge/station_info');
  gSea.clearLayers();
  const rows = g?.data?.station || [];
  if(!rows.length) throw new Error('no sea data');
  rows.forEach(d => {
    const lat = num(d.lat), lon = num(d.lon);
    if(lat==null || lon==null || lat > 7.95) return;   // ชายฝั่งสงขลา–นราธิวาส
    const warn = d.warning?.level === 1;
    const color = warn ? '#dc2626' : '#0d9488';
    L.marker([lat,lon], {icon: mkIcon('mk-sea', color, 20, '~', warn), zIndexOffset:150})
      .bindPopup(()=>`
        <div class="pp-title">🌊 ${esc(d.name_TH||d.name_EN)}</div>
        <div class="pp-sub">${t('seasrc')}</div>
        <div class="pp-status"><span class="badge" style="background:${color};font-size:12px;padding:3px 14px">${warn?t('seawarn'):t('seanormal')}</span></div>
        <dl class="pp-grid">
          <dt>${t('seamon')}</dt><dd>${fmt(num(d.monitoring))}</dd>
          <dt>${t('seamodel')}</dt><dd>${esc((d.warning?.date||'')+' '+(d.warning?.time||''))}</dd>
        </dl>
        <a class="pp-link" href="https://tiwrm.hii.or.th/thaiwater_l5/public/sealevel" target="_blank">${t('seafull')}</a>`, {maxWidth:280})
      .addTo(gSea);
  });
}

/* ---------- 5) CCTV (รวมจาก thaiwater.net + ลิงก์ portal ปภ./ชป.) ---------- */
async function loadCctv(){
  const g = await fetchJSON(`${API}/analyst/cctv`);
  gCctv.clearLayers();
  const rows = Array.isArray(g?.data) ? g.data : [];
  let count = 0;
  rows.forEach(d => {
    const lat = num(d.lat), lon = num(d.long ?? d.lng ?? d.lon);
    if(!inBbox(lat,lon)) return;
    count++;
    const title = thName(d.title) || d.title || 'CCTV';
    const url = d.cctv_url || d.url || '';
    L.marker([lat,lon], {icon: mkIcon('mk-cctv', '#7c3aed', 20, '📷', false), zIndexOffset:50})
      .bindPopup(()=>`
        <div class="pp-title">📷 ${esc(title)}</div>
        <div class="pp-sub">${esc(thName(d.agency?.agency_shortname) || thName(d.agency_name) || '')}</div>
        ${url?`<a class="pp-link" href="${esc(url)}" target="_blank">${t('cctvView')}</a>`:''}
        <div style="text-align:center;font-size:10.5px;color:#64748b;margin-top:4px">${t('cctvNote')}
          <a href="https://cctv.disaster.go.th" target="_blank" style="color:#ea580c">${t('cctvDdpm')}</a> ·
          <a href="https://telerid.rid.go.th/#/" target="_blank" style="color:#ea580c">${t('cctvRid')}</a>
        </div>`, {maxWidth:280})
      .addTo(gCctv);
  });
  if(!count) throw new Error('no cctv in area');
}

/* ---------- 6.4) สถานี CCTV ปภ. (cctv.disaster.go.th) ----------
   ดึงสดจาก ArcGIS FeatureServer ของ ปภ. (gis-portal.disaster.go.th — เปิด CORS สาธารณะ)
   ได้ทั้งพิกัด ระดับน้ำปัจจุบัน สถานะ และสถานะกล้อง / ถ้าดึงไม่ได้ ใช้พิกัดสำรองที่ฝังไว้ */
/* ---- ภาพกล้อง ปภ. (live snapshot) ผ่าน Cloudflare Worker proxy (แก้ CORS ของ cctv.disaster.go.th/api/v1) ----
   ใส่ URL ของ Worker ที่ deploy แล้ว เช่น 'https://ddpm-proxy.xxxx.workers.dev'
   เว้นว่าง '' = ปิดฟีเจอร์ภาพ (popup แสดงข้อมูล+ลิงก์เหมือนเดิม ไม่มี error) */
const DDPM_PROXY = 'https://ddpm-proxy.newusmanwaji.workers.dev';
const DDPM_URL = 'https://gis-portal.disaster.go.th/arcgis/rest/services/Map_DDPM_CCTV/DDPM_CCTV_STATION_PROD/FeatureServer/0/query?where=1%3D1&outFields=code,name,latitude,longitude,basin,agency,telephone,current_water_level,water_level_status,camera_status,updated_at&returnGeometry=false&f=json';
const DDPM_PROV = {'ปภ.จ.ปัตตานี':'ปัตตานี','ปภ.จ.ยะลา':'ยะลา','ปภ.จ.สตูล':'สตูล','ปภ.จ.นราธิวาส':'นราธิวาส','ปภ.จ.สงขลา':'สงขลา'};
/* พิกัดสำรอง (snapshot 3 ก.ค. 2569 จากระบบจริง): [code, name, lat, lon, province] */
const DDPM_STATIONS = [
["NWT01","สะพานข้ามคลอง บ้านปาหนัน ม.4",6.123371,101.510153,"นราธิวาส"],
["NWT02","สะพานข้ามคลองบากง",6.320532,101.508641,"นราธิวาส"],
["NWT03","สะพานกอตอ คลองกอตอ",6.626067,101.62946,"นราธิวาส"],
["NWT04","สะพานข้ามคลองแตแร",6.171484,101.70552,"นราธิวาส"],
["NWT05","สะพานข้ามคลองกูตง",6.222324,101.722414,"นราธิวาส"],
["NWT06","ท่าเรือ(เก่า) ยะกัง 2",6.404825,101.826168,"นราธิวาส"],
["NWT07","ริมแม่น้ำโกลก ท้ายตลาดบูเก๊ะตา",5.83811,101.891466,"นราธิวาส"],
["NWT08","สะพานข้ามคลองอัยบือเลาะ",5.926639,101.883841,"นราธิวาส"],
["NWT09","ริมแม่น้ำโกลก ท่าประปา",6.019205,101.970785,"นราธิวาส"],
["NWT10","สะพานชลประทานมูโนะ",6.074282,102.039744,"นราธิวาส"],
["PTN01","สะพานข้ามแม่น้ำปัตตานี",6.715608,101.285362,"ปัตตานี"],
["PTN02","สะพานบ้านเปี๊ยะ",6.717286,101.262627,"ปัตตานี"],
["PTN03","สะพานข้ามคลองตุยง",6.780583,101.208183,"ปัตตานี"],
["PTN04","สะพานข้ามปากน้ำคลองสายหมอ",6.863561,101.172829,"ปัตตานี"],
["PTN05","สะพานบ้านกูนิง",6.799721,101.252487,"ปัตตานี"],
["PTN06","สถานีสูบน้ำดิบ กปภ.ปัตตานี",6.853328,101.251152,"ปัตตานี"],
["PTN07","แม่น้ำปัตตานี หอนาฬิกาสามวัฒนธรรม",6.867902,101.253166,"ปัตตานี"],
["PTN08","แม่น้ำสายบุรี สะพานข้ามแม่น้ำ ถนน2026",6.595888,101.531731,"ปัตตานี"],
["PTN09","แม่น้ำสายบุรี ใกล้โรงเรียนบ้านละอาร์",6.646486,101.571754,"ปัตตานี"],
["PTN10","แม่น้ำสายบุรี สะพานตะบิ้ง",6.700757,101.608147,"ปัตตานี"],
["STN01","คลองละงู สะพานร้อยเมตร",6.994978,99.88628,"สตูล"],
["STN02","สะพานข้ามคลองละงู ถนน404",6.885812,99.80442,"สตูล"],
["STN03","สะพานข้ามคลองละงู",6.875986,99.78246,"สตูล"],
["STN04","โครงการฝายคลองท่าแพ ดุสน",6.826281,100.0293,"สตูล"],
["STN05","สะพานข้ามคลองท่าแพ หมู่ 3",6.802582,99.96393,"สตูล"],
["STN06","สะพานข้ามคลองโทน",6.855665,100.1502,"สตูล"],
["STN07","ฝายชลประทาน ดุสน",6.803597,100.0968,"สตูล"],
["STN08","สะพานเคียน",6.793254,100.072697,"สตูล"],
["STN09","สะพานข้ามคลองฉลุง ใกล้โรงเรียน",6.720299,100.063904,"สตูล"],
["STN10","สะพานข้ามคลองตาลีไกล",6.632142,100.060978,"สตูล"],
["YLA01","สะพานข้ามคลองเบตง",5.772517,101.09375,"ยะลา"],
["YLA02","แม่น้ำปัตตานี ทต.เขื่อนบางลาง",6.161274,101.275597,"ยะลา"],
["YLA03","สะพานยีลาปัน (สะพานเหล็ก)",6.27842,101.28981,"ยะลา"],
["YLA04","สะพานข้ามแม่น้ำปัตตานี",6.411693,101.276962,"ยะลา"],
["YLA05","สะพานข้ามคลองปะแต",6.412775,101.138679,"ยะลา"],
["YLA06","คลองละแอ ริมถนนหน้า ชคต.ละแอ",6.473238,101.163567,"ยะลา"],
["YLA07","แม่น้ำปัตตานี ทต.ท่าสาป",6.542121,101.252167,"ยะลา"],
["YLA08","สะพานข้ามคลองลำดา",6.58688,101.276077,"ยะลา"],
["YLA09","สะพานเฉลิมพระเกียรติ",6.44175,101.465195,"ยะลา"],
["YLA10","สะพานมิตรภาพท่าธง-เกะรอ แม่น้ำสายบุรี",6.549634,101.486618,"ยะลา"]
];
function ddpmStatusInfo(st){
  const s = String(st||'').toUpperCase();
  if(s==='LOW')      return {label:t('ddpmLow'),  color:'#22c55e', blink:false};
  if(s==='MEDIUM')   return {label:t('ddpmMed'),  color:'#eab308', blink:false};
  if(s==='HIGH')     return {label:t('ddpmHigh'), color:'#f97316', blink:false};
  if(s==='VERYHIGH'||s==='CRITICAL'||s==='CRISIS') return {label:t('ddpmCrit'), color:'#dc2626', blink:true};
  return {label:t('nodata'), color:'#9ca3af', blink:false};
}
function ddpmMarker(row){
  // row: {code,name,lat,lon,prov, wl?, status?, cam?, tel?, updated?}
  const S = ddpmStatusInfo(row.status);
  const live = row.status !== undefined;
  const m = L.marker([row.lat,row.lon], {icon: mkIcon('mk-ddpm', live ? S.color : '#b91c1c', 20, '📹', S.blink), zIndexOffset:120})
    .bindPopup(()=>{
      const S2 = ddpmStatusInfo(row.status);
      return `
      <div class="pp-title">📹 ${esc(row.name)} (${esc(row.code)})</div>
      <div class="pp-sub">${tProv(row.prov)} · ${t('ddpmSrc')}</div>
      <div class="ddpm-snap" id="snap-${esc(row.code)}" style="margin:6px 0"></div>
      ${live?`<div class="pp-status"><span class="badge" style="background:${S2.color};font-size:12px;padding:3px 14px">${S2.label}${row.wl!=null?` · ${fmt(row.wl)} m`:''}</span></div>`:''}
      <dl class="pp-grid">
        <dt>${t('ddpmCoord')}</dt><dd>${row.lat.toFixed(5)}, ${row.lon.toFixed(5)}</dd>
        ${live&&row.wl!=null?`<dt>${t('ddpmWL')}</dt><dd>${fmt(row.wl)}</dd>`:''}
        ${live?`<dt>${t('ddpmCam')}</dt><dd>${row.cam===1?t('camOn'):t('camOff')}</dd>`:''}
        ${row.tel?`<dt>${t('ddpmTel')}</dt><dd>${esc(row.tel)}</dd>`:''}
        ${row.updated?`<dt>${t('time')}</dt><dd>${new Date(row.updated).toLocaleString(locale(),{dateStyle:'short',timeStyle:'short'})}</dd>`:''}
      </dl>
      <a class="pp-link" href="https://cctv.disaster.go.th/stations/${esc(row.code)}" target="_blank" rel="noopener">📊 ผลวิเคราะห์</a>`;
    }, {maxWidth:300});
  m.on('popupopen', ()=>loadDdpmSnapshot(row));
  m.addTo(gDdpm);
}
/* ดึงภาพ snapshot ล่าสุดของกล้อง ปภ. ผ่าน DDPM_PROXY (Cloudflare Worker แก้ CORS)
   GET <proxy>/stations/{code} → histories[0].snapshotPath ; ภาพอยู่ที่ <proxy>/<snapshotPath> */
async function loadDdpmSnapshot(row){
  const el = document.getElementById('snap-'+row.code);
  if(!el) return;
  if(!DDPM_PROXY){ el.innerHTML=''; return; }
  const base = DDPM_PROXY.replace(/\/+$/,'');
  el.innerHTML = '<div style="font-size:11px;color:#64748b">📷 กำลังโหลดภาพกล้อง…</div>';
  try{
    const j = await fetch(base+'/stations/'+encodeURIComponent(row.code), {cache:'no-store'}).then(r=>r.json());
    const d = j.data||j;
    const h0 = (d.histories||d.history||[])[0];
    const bank = (d.riverBankLevel!=null ? d.riverBankLevel : d.dpmRiverBankLevel);
    const cur  = (d.currentWaterLevel!=null ? d.currentWaterLevel : (h0 && h0.level));
    if(!h0 || !h0.snapshotPath){ el.innerHTML = '<div style="font-size:11px;color:#64748b">ยังไม่มีภาพล่าสุดจากกล้องนี้</div>'; return; }
    const sp1 = String(h0.snapshotPath).replace(/^\/+/,'');
    const sib = p => p.replace(/_(\d{1,2})(\.[a-z]+)$/i, (m,n,e)=>'_'+((n.replace(/^0/,'')==='1')?'02':'01')+e);
    const sp2 = sib(sp1);
    const is01 = /_0?1\.[a-z]+$/i.test(sp1);
    const path1 = is01 ? sp1 : sp2;   // กล้อง 1 (_01)
    const path2 = is01 ? sp2 : sp1;   // กล้อง 2 (_02)
    const url1 = base+'/'+path1, url2 = base+'/'+path2;
    const nCam = Array.isArray(d.cameras) ? d.cameras.length : 1;
    const twoCam = nCam>=2 && sp2!==sp1;
    const tstr = h0.timeStamp ? new Date(h0.timeStamp).toLocaleString(locale(),{dateStyle:'short',timeStyle:'short'}) : '';
    const off = h0.isOnline===false;
    const info = '📷 ภาพล่าสุด '+esc(tstr)
      + (cur!=null  ? ' · ระดับน้ำ '+fmt(cur)+' ม.'  : '')
      + (bank!=null ? ' · ตลิ่ง '+fmt(bank)+' ม.' : '')
      + (off ? ' · ⚠️ กล้องออฟไลน์' : '');
    const st = 'width:100%;border-radius:8px;border:1px solid #e3e0dd;cursor:zoom-in;background:#eef1ee';
    const tabs = twoCam
      ? '<div class="ddpm-tabs"><button type="button" class="ddpm-tab on" onclick="ddpmCam(this,\''+esc(url1)+'\')">กล้อง 1</button>'
        + '<button type="button" class="ddpm-tab" onclick="ddpmCam(this,\''+esc(url2)+'\')">กล้อง 2</button></div>'
      : '';
    el.innerHTML = '<div class="ddpm-cams">'+tabs
      + '<img class="ddpm-img" src="'+esc(url1)+'" alt="ภาพกล้อง '+esc(row.code)+'" style="'+st+'" onclick="window.open(this.src,\'_blank\')">'
      + '<div style="font-size:10.5px;color:#64748b;margin-top:3px">'+info+'</div></div>';
  }catch(e){ el.innerHTML = '<div style="font-size:11px;color:#ef4444">โหลดภาพไม่สำเร็จ — ตรวจสอบว่าตั้งค่า DDPM_PROXY ถูกต้อง</div>'; }
}
/* สลับกล้องในภาพ popup */
function ddpmCam(btn, url){
  const w = btn.closest('.ddpm-cams'); if(!w) return;
  const img = w.querySelector('img.ddpm-img'); if(img) img.src = url;
  w.querySelectorAll('.ddpm-tab').forEach(b=>b.classList.toggle('on', b===btn));
}
async function loadDdpm(){
  gDdpm.clearLayers();
  try{
    const g = await fetchJSON(DDPM_URL, 20000);
    const rows = (g?.features||[]).map(f=>f.attributes)
      .filter(a => DDPM_PROV[a.agency] && num(a.latitude)!=null && num(a.longitude)!=null);
    if(!rows.length) throw new Error('empty');
    rows.forEach(a => ddpmMarker({
      code:a.code, name:String(a.name||'').trim(), lat:num(a.latitude), lon:num(a.longitude),
      prov:DDPM_PROV[a.agency], wl:num(a.current_water_level), status:a.water_level_status,
      cam:a.camera_status, tel:a.telephone||'', updated:num(a.updated_at)
    }));
  }catch(e){
    // ดึงสดไม่ได้ → ใช้พิกัดสำรอง (ไม่มีค่าระดับน้ำ)
    DDPM_STATIONS.forEach(r => ddpmMarker({code:r[0], name:r[1], lat:r[2], lon:r[3], prov:r[4]}));
  }
}
function openDdpm(){
  const f = document.getElementById('ddpmFrame');
  if(!f.src) f.src = 'https://cctv.disaster.go.th';   // โหลดเมื่อเปิดครั้งแรกเท่านั้น
  document.getElementById('ddpmModal').classList.add('show');
}

/* ---------- 6.5) สถานีโทรมาตร กรมชลประทาน (telerid.rid.go.th) ----------
   ภาพ+ระดับน้ำมาจาก scraper (Playwright + GitHub Action) ที่ publish ไว้สาขา cam
   ดูวิธีตั้งค่าใน telerid-scraper/README.md — เปลี่ยน repo/สาขาได้ที่ TELERID_CAM */
const TELERID_CAM = 'https://raw.githubusercontent.com/usmanwaji/waterchaidantai/cam';
async function loadTelerid(){
  gTele.clearLayers();
  // 1) ใช้ภาพ+ข้อมูลที่ scraper ดึงมา (สาขา cam) ก่อน
  try{
    const j = await fetchJSON(`${TELERID_CAM}/stations.json`, 15000);
    const rows = Array.isArray(j?.stations) ? j.stations : [];
    let n = 0;
    rows.forEach(d => {
      const lat = num(d.lat), lon = num(d.lon);
      if(lat==null || lon==null) return;
      if(PROV_SET.size && !PROV_SET.has(String(d.province||'').trim())) return;
      n++;
      const mk = L.marker([lat,lon], {icon: mkIcon('mk-tele', '#1e40af', 18, '▲', false), zIndexOffset:80})
        .bindPopup(()=>{
          const upd = j.updated ? new Date(j.updated).toLocaleString(locale(),{dateStyle:'short',timeStyle:'short'}) : '';
          const img = d.hasImage
            ? `<img src="${TELERID_CAM}/${esc(d.code)}.jpg?v=${encodeURIComponent(j.updated||'')}" alt="กล้อง ${esc(d.code)}" style="width:100%;border-radius:8px;border:1px solid #e3e0dd;cursor:zoom-in;background:#eef1ee;margin:6px 0" onclick="window.open(this.src,'_blank')">`
            : '';
          const crit = d.critical ?? d.bank;
          return `
          <div class="pp-title">▲ ${esc(d.name||d.code||'')} (${esc(d.code)})</div>
          <div class="pp-sub">${esc(d.basin||'')} · ${esc(d.amphur||'')} · ${tProv(String(d.province||'').trim())} · ${t('teleSrc')}</div>
          ${img}
          <dl class="pp-grid">
            ${d.level!=null?`<dt>${t('ddpmWL')}</dt><dd><b>${fmt(d.level)}</b> ม.</dd>`:''}
            ${d.warning!=null?`<dt style="color:#ea9a16">ระดับเฝ้าระวัง</dt><dd>${fmt(d.warning)} ม.</dd>`:''}
            ${crit!=null?`<dt style="color:#dc2626">ระดับวิกฤต</dt><dd>${fmt(crit)} ม.</dd>`:''}
          </dl>
          ${d.hasDetail?`<div class="tele-detail" data-code="${esc(d.code)}" style="font-size:11px;color:#94a3b8;margin:4px 0">กำลังโหลดกราฟ…</div>`:''}
          <div style="font-size:10px;color:#94a3b8">${img?'📷 ภาพล่าสุด ':'อัปเดต '}${esc(upd)}</div>
          <a class="pp-link" href="https://telerid.rid.go.th/#/" target="_blank">${t('teleView')}</a>`;
        }, {maxWidth:320})
        .addTo(gTele);
      if(d.hasDetail){
        mk.on('popupopen', (ev)=>{
          const el = ev.popup.getElement().querySelector('.tele-detail');
          if(!el || el.dataset.loaded) return;
          el.dataset.loaded = '1';
          renderTeleDetail(el, d.code);
        });
      }
    });
    if(n>0) return;   // ใช้ข้อมูล scraper สำเร็จ
  }catch(e){ /* ยังไม่มีสาขา cam / scraper ยังไม่รัน → ใช้ station_list สดแบบเดิม */ }

  // 2) fallback: station_list สด (ลิงก์อย่างเดียว)
  try{
    const g = await fetchJSON('https://telerid.rid.go.th/restapi/main/station_list/', 20000);
    const rows = Array.isArray(g?.results) ? g.results : (Array.isArray(g) ? g : []);
    rows.forEach(d => {
      if(!PROV_SET.has(String(d.province_name||'').trim())) return;
      const co = d.geom?.coordinates;
      const lon = num(co?.[0]), lat = num(co?.[1]);
      if(lat==null || lon==null) return;
      L.marker([lat,lon], {icon: mkIcon('mk-tele', '#1e40af', 18, '▲', false), zIndexOffset:80})
        .bindPopup(()=>`
          <div class="pp-title">▲ ${esc(d.name||d.code||'')} ${d.code&&d.name?`(${esc(d.code)})`:''}</div>
          <div class="pp-sub">${esc(d.basin_name||'')} · ${esc(d.amphur_name||'')} · ${tProv(String(d.province_name||'').trim())} · ${t('teleSrc')}</div>
          ${d.project_name?`<dl class="pp-grid"><dt>${t('teleProj')}</dt><dd>${esc(d.project_name)}</dd></dl>`:''}
          <a class="pp-link" href="https://telerid.rid.go.th/#/" target="_blank">${t('teleView')}</a>`, {maxWidth:280})
        .addTo(gTele);
    });
  }catch(e){ /* ถูกบล็อก CORS — ใช้ลิงก์โทรมาตรในหมุดสถานี ชป. แทน */ }
}

/* ---------- 6.6) รายละเอียดสถานีโทรมาตร: กราฟระดับน้ำ + น้ำฝน + ภาพตัดลำน้ำ ----------
   ดึงไฟล์ {code}.detail.json (จาก scraper) ตอนเปิด popup แล้ววาดเป็น SVG ในตัว */
async function renderTeleDetail(el, code){
  try{
    const det = await fetchJSON(`${TELERID_CAM}/${encodeURIComponent(code)}.detail.json`, 15000);
    const html = teleDetailHTML(det);
    el.style.color=''; el.innerHTML = html || '';
  }catch(e){ el.innerHTML=''; }
}
function teleDetailHTML(det){
  let h='';
  if(det.wl && Array.isArray(det.wl.v)) h += teleWLChart(det);
  if(det.rain && Array.isArray(det.rain.v)) h += teleRainChart(det);
  if(det.cross) h += teleCrossSection(det);
  return h;
}
function teleWLChart(det){
  const W=284,H=96,pl=36,pr=8,pt=8,pb=8;
  const v=det.wl.v, n=v.length;
  const pts=v.map((y,i)=>({i,y})).filter(p=>p.y!=null);
  if(pts.length<2) return '';
  const warn=det.warning, crit=det.critical;
  const ys=pts.map(p=>p.y);
  let ymin=Math.min(...ys), ymax=Math.max(...ys);
  if(warn!=null){ymin=Math.min(ymin,warn);ymax=Math.max(ymax,warn);}
  if(crit!=null){ymin=Math.min(ymin,crit);ymax=Math.max(ymax,crit);}
  const pad=(ymax-ymin)*0.12||0.2; ymin-=pad; ymax+=pad;
  const X=i=> pl+(W-pl-pr)*(i/(n-1));
  const Y=y=> pt+(H-pt-pb)*(1-(y-ymin)/(ymax-ymin));
  const line=pts.map((p,k)=>`${k?'L':'M'}${X(p.i).toFixed(1)},${Y(p.y).toFixed(1)}`).join('');
  const gl=(y,c)=> (y!=null&&y>=ymin&&y<=ymax)?`<line x1="${pl}" y1="${Y(y).toFixed(1)}" x2="${W-pr}" y2="${Y(y).toFixed(1)}" stroke="${c}" stroke-width="1" stroke-dasharray="3 2"/>`:'';
  const yt=y=>`<text x="${pl-4}" y="${(Y(y)+3).toFixed(1)}" font-size="9" fill="#94a3b8" text-anchor="end">${y.toFixed(2)}</text>`;
  const last=pts[pts.length-1].y;
  return `<div style="font-size:11px;color:#475569;margin:6px 0 2px">ระดับน้ำ 48 ชม. <b style="color:#0369a1">${last.toFixed(2)} ม.</b></div>
  <svg viewBox="0 0 ${W} ${H}" style="width:100%;background:#f8fafc;border:1px solid #e3e0dd;border-radius:6px">
    ${gl(warn,'#ea9a16')}${gl(crit,'#dc2626')}
    <path d="${line}" fill="none" stroke="#0ea5e9" stroke-width="1.6"/>
    ${yt(ymax)}${yt(ymin)}
  </svg>`;
}
function teleRainChart(det){
  const v=det.rain.v.map(x=>x==null?0:x), n=v.length;
  if(!n) return '';
  const W=284,H=42,pl=36,pr=8,pt=6,pb=8;
  const ymax=Math.max(0.5,...v);
  const bw=(W-pl-pr)/n;
  const X=i=> pl+bw*i;
  const Y=y=> pt+(H-pt-pb)*(1-y/ymax);
  const bars=v.map((y,i)=> y>0?`<rect x="${X(i).toFixed(1)}" y="${Y(y).toFixed(1)}" width="${Math.max(0.8,bw-0.4).toFixed(1)}" height="${(H-pb-Y(y)).toFixed(1)}" fill="#2563eb"/>`:'').join('');
  const sum24=v.slice(-96).reduce((a,b)=>a+b,0);
  return `<div style="font-size:11px;color:#475569;margin:6px 0 2px">ฝนสะสม 24 ชม. <b style="color:#2563eb">${sum24.toFixed(1)} มม.</b></div>
  <svg viewBox="0 0 ${W} ${H}" style="width:100%;background:#f8fafc;border:1px solid #e3e0dd;border-radius:6px">
    <text x="${pl-4}" y="${pt+6}" font-size="9" fill="#94a3b8" text-anchor="end">${ymax.toFixed(0)}</text>
    ${bars}
  </svg>`;
}
function teleCrossSection(det){
  const cs=det.cross;
  if(!cs||!Array.isArray(cs.distance)||!Array.isArray(cs.high)||cs.distance.length<2) return '';
  const W=284,H=118,pl=32,pr=8,pt=10,pb=14;
  const dist=cs.distance, high=cs.high;
  const xmin=Math.min(...dist), xmax=Math.max(...dist);
  const level=det.level, warn=cs.warning??det.warning, crit=cs.critical??det.critical;
  const ys=high.slice(); [level,warn,crit].forEach(y=>{if(y!=null)ys.push(y);});
  let ymin=Math.min(...ys), ymax=Math.max(...ys);
  const pad=(ymax-ymin)*0.1||0.3; ymin-=pad; ymax+=pad;
  const X=x=> pl+(W-pl-pr)*((x-xmin)/(xmax-xmin||1));
  const Y=y=> pt+(H-pt-pb)*(1-(y-ymin)/(ymax-ymin));
  const prof=dist.map((x,i)=>`${i?'L':'M'}${X(x).toFixed(1)},${Y(high[i]).toFixed(1)}`).join('');
  const earth=`${prof} L${X(xmax).toFixed(1)},${(H-pb).toFixed(1)} L${X(xmin).toFixed(1)},${(H-pb).toFixed(1)} Z`;
  const water=(level!=null&&level>ymin)?`<rect x="${pl}" y="${Y(level).toFixed(1)}" width="${(W-pl-pr).toFixed(1)}" height="${(H-pb-Y(level)).toFixed(1)}" fill="#7dd3fc" opacity="0.7"/>`:'';
  const hl=(y,c,lbl)=> (y!=null&&y>=ymin&&y<=ymax)?`<line x1="${pl}" y1="${Y(y).toFixed(1)}" x2="${W-pr}" y2="${Y(y).toFixed(1)}" stroke="${c}" stroke-width="1" stroke-dasharray="3 2"/><text x="${W-pr}" y="${(Y(y)-2).toFixed(1)}" font-size="8" fill="${c}" text-anchor="end">${lbl}</text>`:'';
  return `<div style="font-size:11px;color:#475569;margin:6px 0 2px">ภาพตัดลำน้ำ</div>
  <svg viewBox="0 0 ${W} ${H}" style="width:100%;background:#eef6fb;border:1px solid #e3e0dd;border-radius:6px">
    ${water}
    <path d="${earth}" fill="#d6c7a8" stroke="#a1885a" stroke-width="1"/>
    ${hl(crit,'#dc2626','วิกฤต')}${hl(warn,'#ea9a16','เฝ้าระวัง')}
    ${(level!=null&&level>=ymin&&level<=ymax)?`<line x1="${pl}" y1="${Y(level).toFixed(1)}" x2="${W-pr}" y2="${Y(level).toFixed(1)}" stroke="#0284c7" stroke-width="1.5"/><text x="${pl}" y="${(Y(level)-2).toFixed(1)}" font-size="8" fill="#0369a1">น้ำ ${level.toFixed(2)}</text>`:''}
  </svg>`;
}

/* ---------- 6) จุดเสี่ยงน้ำท่วมฉับพลัน 24 ชม. (HII) ---------- */
async function loadFlashFlood(){
  const banner = document.getElementById('banner');
  gRisk.clearLayers(); riskAreas = [];
  try{
    const g = await fetchJSON('https://api.hii.or.th/v2/4UQaYnf0Bx4fXPYyCdDRbqHyXH9Ixvd2nVUjaN1cLBY=/warning/flashflood-24h');
    const areas = (g?.area || g?.data?.area || []).filter(a => PROV_SET.has(a.province));
    riskAreas = areas;
    areas.forEach(a => {
      const lat = num(a.latitude), lon = num(a.longitude);
      if(lat==null || lon==null) return;
      const mm = num(a.sum_rainfall_24h);
      L.marker([lat,lon], {icon: mkIcon('mk-risk', '#ea580c', 20, '⚠', true), zIndexOffset:300})
        .bindPopup(()=>`
          <div class="pp-title">⚠ ${t('riskTitle')}</div>
          <div class="pp-sub">${esc(a.tambon||'')} · ${esc(a.amphoe||'')} · ${tProv(a.province)}</div>
          <dl class="pp-grid">
            <dt>${t('riskRain')}</dt><dd>${fmt(mm,1)}</dd>
            <dt>${t('time')}</dt><dd>${esc(a.latest_rainfall_datetime||'')}</dd>
          </dl>
          <div style="text-align:center;font-size:10.5px;color:#64748b;margin-top:4px">${t('riskSrc')}</div>`, {maxWidth:270})
        .addTo(gRisk);
    });
    if(areas.length){
      const spots = [...new Set(areas.map(a=>`${a.amphoe} · ${tProv(a.province)}`))].slice(0,6).join(', ');
      banner.innerHTML = `${t('bannerFF')} ${esc(spots)}${areas.length>6?' '+t('andMore'):''}`;
      banner.classList.add('show');
    } else banner.classList.remove('show');
  }catch(e){
    // API หลักถูกบล็อก CORS ในบางเครือข่าย → ใช้รายงานพื้นที่เสี่ยง (CSV) ของ สสน. แทน (ระดับตำบล ไม่มีพิกัด)
    try{
      const txt = await fetch('https://fews2.hii.or.th/model-output/data_portal/flashflood/flashflood_report.txt').then(r=>r.text());
      const rows = txt.split('\n').slice(1).map(l=>[...l.matchAll(/"([^"]*)"/g)].map(m=>m[1]))
        .filter(c=>c.length>=4 && PROV_SET.has(c[1]));
      if(rows.length){
        const spots = [...new Set(rows.map(c=>`${c[2]} · ${tProv(c[1])}`))].slice(0,6).join(', ');
        banner.innerHTML = `${t('bannerFF')} ${esc(spots)}${rows.length>6?' '+t('andMore'):''}`;
        banner.classList.add('show');
      } else banner.classList.remove('show');
    }catch(e2){ banner.classList.remove('show'); }
  }
}

/* ---------- 7) ขอบเขตจังหวัด (GeoJSON, มีแหล่งสำรอง) ---------- */
const BND_SOURCES = [
  'https://raw.githubusercontent.com/apisit/thailand.json/master/thailand.json',
  'https://raw.githubusercontent.com/chingchai/OpenGISData-Thailand/master/provinces.geojson'
];
const BND_NAMES = ['สตูล','สงขลา','ปัตตานี','ยะลา','นราธิวาส','Satun','Songkhla','Pattani','Yala','Narathiwat'];
async function loadBoundaries(){
  for(const src of BND_SOURCES){
    try{
      const gj = await fetchJSON(src, 40000);
      const feats = (gj.features||[]).filter(f => {
        const props = f.properties || {};
        return Object.values(props).some(v => typeof v==='string' && BND_NAMES.includes(v.trim()));
      });
      if(feats.length < PROVINCES.length) continue;
      gBnd.clearLayers();
      // เส้นขอบสองชั้น: ขาวด้านล่าง + เข้มด้านบน ให้เห็นชัดทั้งแผนที่ถนนและดาวเทียม
      L.geoJSON({type:'FeatureCollection',features:feats}, {pane:'bnd', interactive:false,
        style:{color:'#ffffff', weight:5, opacity:.9, fill:false}}).addTo(gBnd);
      L.geoJSON({type:'FeatureCollection',features:feats}, {pane:'bnd', interactive:false,
        style:{color:'#334155', weight:2.2, opacity:1, dashArray:'6 3', fill:true, fillColor:'#0ea5e9', fillOpacity:0.03}}).addTo(gBnd);
      // ป้ายชื่อจังหวัด
      feats.forEach(f => {
        const props = f.properties || {};
        const raw = Object.values(props).find(v => typeof v==='string' && BND_NAMES.includes(v.trim()));
        const thai = {'Satun':'สตูล','Songkhla':'สงขลา','Pattani':'ปัตตานี','Yala':'ยะลา','Narathiwat':'นราธิวาส'}[raw?.trim()] || raw?.trim();
        try{
          const c = L.geoJSON(f).getBounds().getCenter();
          L.marker(c, {pane:'bnd', interactive:false,
            icon: L.divIcon({className:'provlabel', html:`<div>${esc(tProv(thai))}</div>`, iconSize:[120,20], iconAnchor:[60,10]})
          }).addTo(gBnd);
        }catch(e){}
      });
      return;
    }catch(e){ /* ลองแหล่งถัดไป */ }
  }
}
/* ================= Sidebar ================= */
function renderSidebar(){
  const q = document.getElementById('search').value.trim().toLowerCase();
  const inProv = wlStations.filter(s => filterProv==='all' || s.prov===filterProv);
  const counts = {};
  Object.keys(WL_CLASSES).forEach(k=>counts[k]=0);
  inProv.forEach(s=>counts[s.cls]++);

  document.getElementById('summary').innerHTML = ['overflow','high','normal','low','critlow'].map(k=>{
    const C = WL_CLASSES[k];
    return `<div class="sumcard ${filterClass===k?'active':''}" style="background:${C.color}" onclick="toggleClass('${k}')">
      <b>${counts[k]}</b><span>${wlLabel(k)}</span></div>`;
  }).join('');

  const list = inProv
    .filter(s => !filterClass || s.cls===filterClass)
    .filter(s => !q || [s.name,s.river,s.amphoe,s.code,s.prov].join(' ').toLowerCase().includes(q))
    .sort((a,b)=> WL_CLASSES[a.cls].order - WL_CLASSES[b.cls].order || (b.pct??-1)-(a.pct??-1));

  document.getElementById('list').innerHTML = list.map(s=>{
    const C = WL_CLASSES[s.cls];
    return `<div class="item" style="border-left-color:${C.color}" onclick="focusStation('${s.id}')">
      <div class="nm">${esc(s.name)} ${s.code?`<span style="color:#94a3b8;font-weight:400">(${esc(s.code)})</span>`:''}</div>
      <div class="sub">${esc(s.river||'')} · ${esc(s.amphoe)} · ${tProv(s.prov)} ${isStale(s.dt)?`<span class="stale">${t('stale')}</span>`:''}</div>
      <div class="row2">
        <span class="badge" style="background:${C.color}">${wlLabel(s.cls)}${s.pct!=null?` ${fmt(s.pct,0)}%`:''}</span>
        <span style="color:#64748b">${s.msl!=null?fmt(s.msl)+' m':''}${trendArrow(s)}</span>
      </div></div>`;
  }).join('') || `<div style="text-align:center;color:#64748b;font-size:13px;padding:20px 0">${t('listEmpty')}</div>`;
}

function toggleClass(k){ filterClass = (filterClass===k) ? null : k; renderSidebar(); }
function toggleSidebar(){
  const sb = document.getElementById('sidebar');
  const btn = document.getElementById('btnCollapse');
  const hidden = sb.classList.toggle('hidden');
  btn.classList.toggle('closed', hidden);
  btn.textContent = hidden ? '▶' : '◀';
  setTimeout(()=>map.invalidateSize(), 250);
}
function focusStation(id){
  const m = markersById[id];
  if(!m) return;
  if(!map.hasLayer(gWL)){ map.addLayer(gWL); document.getElementById('lyWL').checked = true; }
  if(window.innerWidth<=768) document.getElementById('sidebar').classList.remove('open');
  map.flyTo(m.getLatLng(), Math.max(map.getZoom(), 12), {duration:.6});
  setTimeout(()=>m.openPopup(), 650);
}

document.getElementById('search').addEventListener('input', renderSidebar);
const PROV_VIEWS = {
  'all':[[6.85,100.85],8],
  'สตูล':[[6.75,100.05],10],
  'สงขลา':[[7.10,100.60],9],
  'ปัตตานี':[[6.70,101.30],10],
  'ยะลา':[[6.30,101.25],10],
  'นราธิวาส':[[6.20,101.75],10]
};
document.querySelectorAll('.provbtn').forEach(b=>{
  b.onclick = () => {
    document.querySelectorAll('.provbtn').forEach(x=>x.classList.remove('active'));
    b.classList.add('active');
    filterProv = b.dataset.prov;
    renderSidebar();
    const v = PROV_VIEWS[filterProv];
    if(v) map.flyTo(v[0], v[1], {duration:.6});
  };
});

/* ================= คัดลอกรายงานสถานการณ์ ================= */
function copyReport(){
  const now = new Date().toLocaleString(locale(),{dateStyle:'medium', timeStyle:'short'});
  const lines = [t('rpTitle'), `🕐 ${now}`, ''];
  PROVINCES.forEach(p=>{
    const st = wlStations.filter(s=>s.prov===p.name);
    if(!st.length) return;
    const o = st.filter(s=>s.cls==='overflow').length, h = st.filter(s=>s.cls==='high').length;
    lines.push(`• ${tProv(p.name)}: ${wlLabel('overflow')} ${o} · ${wlLabel('high')} ${h} / ${st.length} ${t('rpStations')}`);
  });
  const crit = wlStations.filter(s=>s.cls==='overflow'||s.cls==='high')
    .sort((a,b)=>(b.pct??0)-(a.pct??0)).slice(0,10);
  lines.push('');
  if(crit.length){
    lines.push(t('rpCrit'));
    crit.forEach(s=>lines.push(`  - ${s.name}${s.code?` (${s.code})`:''} ${s.amphoe}·${tProv(s.prov)} — ${wlLabel(s.cls)} ${s.pct!=null?fmt(s.pct,0)+'%':''} (${fmt(s.diff)} m)`));
  } else lines.push(t('rpNoCrit'));
  const topRain = [...rainSpots].sort((a,b)=>b.mm-a.mm).slice(0,3);
  if(topRain.length){
    lines.push('', t('rpRainMax'));
    topRain.forEach(r=>lines.push(`  - ${r.name} ${r.amphoe}·${tProv(r.prov)} ${fmt(r.mm,1)} mm`));
  }
  if(damList.length){
    lines.push('', t('rpDam'));
    damList.forEach(d=>lines.push(`  - ${d.name} ${d.pct!=null?fmt(d.pct,1)+t('pctcap'):t('nodata')}`));
  }
  if(riskAreas.length){
    lines.push('', t('rpRisk'));
    [...new Set(riskAreas.map(a=>`${a.amphoe} · ${tProv(a.province)}`))].slice(0,8).forEach(x=>lines.push(`  - ${x}`));
  }
  lines.push('', t('rpSrc'));
  const text = lines.join('\n');
  const done = () => { const b=document.getElementById('btnReport'); const old=b.textContent; b.textContent='✅ '+t('copied'); setTimeout(()=>b.textContent=t('report'), 2500); };
  if(navigator.clipboard?.writeText){ navigator.clipboard.writeText(text).then(done).catch(()=>fallbackCopy(text,done)); }
  else fallbackCopy(text,done);
}
function fallbackCopy(text,done){
  const ta=document.createElement('textarea'); ta.value=text; document.body.appendChild(ta);
  ta.select(); try{document.execCommand('copy'); done();}catch(e){} document.body.removeChild(ta);
}

/* ================= สลับภาษา ================= */
function applyLang(){
  document.documentElement.lang = lang;
  document.getElementById('hTitle').innerHTML = `${t('title')}<small id="hSub">${t('sub')}</small>`;
  document.getElementById('btnRefreshTxt').textContent = t('refresh');
  document.getElementById('search').placeholder = t('search');
  document.querySelector('.provbtn[data-prov="all"]').textContent = t('all');
  document.querySelectorAll('.provbtn').forEach(b=>{ if(b.dataset.prov!=='all') b.textContent = tProv(b.dataset.prov); });
  [['tWL','lyWL'],['tRain','lyRain'],['tDam','lyDam'],['tSea','lySea'],['tCctv','lyCctv'],['tDdpm','lyDdpm'],['tTele','lyTele'],['tRisk','lyRisk']]
    .forEach(([sp,key])=>document.getElementById(sp).textContent = t(key));
  document.getElementById('btnReport').textContent = t('report');
  document.getElementById('btnDdpm').textContent = t('extDdpm');
  document.getElementById('btnTelerid').textContent = t('extTelerid');
  document.getElementById('ddpmTitle').textContent = t('ddpmModalTitle');
  document.getElementById('ddpmNewTab').textContent = t('ddpmNewTabLbl');
  document.getElementById('ddpmNote').textContent = t('ddpmNoteTxt');
  document.getElementById('fSrc').textContent = t('src');
  document.getElementById('fNote').innerHTML = t('note');
  document.getElementById('btnHelp').textContent = t('help');
  document.getElementById('hbTitle').textContent = t('helpTitle');
  document.getElementById('hbBody').innerHTML = t('helpBody');
  buildLegend();
  renderSidebar();
}
document.querySelectorAll('.langbtn').forEach(b=>{
  b.onclick = () => {
    document.querySelectorAll('.langbtn').forEach(x=>x.classList.remove('active'));
    b.classList.add('active');
    lang = b.dataset.lang;
    try{ localStorage.setItem('onemap_lang', lang); }catch(e){}
    applyLang();
    loadBoundaries();        // วาดป้ายชื่อจังหวัดใหม่ตามภาษา (ใช้ cache เบราว์เซอร์)
    loadFlashFlood();        // แบนเนอร์ตามภาษา
  };
});
document.querySelectorAll('.langbtn').forEach(b=>b.classList.toggle('active', b.dataset.lang===lang));

/* ================= เริ่มทำงาน ================= */
applyLang();
loadAll();
loadBoundaries();
setInterval(loadAll, 10*60*1000);

/* วาดแม่น้ำสายหลัก (thick blue) */
if (window.OMSRivers) window.OMSRivers.drawLeaflet(map);
