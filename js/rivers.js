/* js/rivers.js · วาดแม่น้ำสายหลักของ 5 จังหวัดชายแดนใต้ เป็นเส้นสีน้ำเงินหนา
 * ข้อมูลจริงจาก OpenStreetMap (waterway ที่มีชื่อ: สายบุรี, ปัตตานี, โก-ลก,
 * บางนรา, อู่ตะเภา, ละงู, ปะเหลียน, เทพา ฯลฯ)
 * - ดึงครั้งแรกจาก Overpass API แล้วแคชใน localStorage (แม่น้ำแทบไม่เปลี่ยน)
 * - ครั้งต่อไปวาดทันทีจากแคช ไม่พึ่ง network
 * ใช้: window.OMSRivers.drawLeaflet(map)  หรือ  window.OMSRivers.drawGoogle(gMap)
 */
(function () {
  'use strict';
  // v2: ดึงเส้นของ "แม่น้ำทั้งสาย" (relation) ด้วย · เปลี่ยน key ให้ทุกเครื่องโหลดใหม่ (แคช v1 ขาดบางช่วง เช่น บางนรา)
  // v3: เพิ่มคลองตันหยงมัส · เปลี่ยน key ให้ทุกเครื่องโหลดใหม่
  const KEY = 'oms_rivers_v3';
  const OLD_KEYS = ['oms_rivers_v1', 'oms_rivers_v2'];
  const OVERPASS = 'https://overpass-api.de/api/interpreter';
  const BB = '(5.6,99.55,7.9,102.15)';
  const TH = 'สายบุรี|ปัตตานี|โกลก|โก-ลก|บางนรา|อู่ตะเภา|ละงู|ปะเหลียน|เทพา|นาทวี|บางลาง|ตากใบ|ตันหยงมัส|ต้นหยงมัส';
  const EN = 'Sai ?Buri|Pattani|Kolok|Golok|Bang ?Nara|U-?Taphao|La-?ngu|Pa ?Lian|Thepha|Na ?Thawi|Bang ?Lang|Tak ?Bai|Tan ?Yong ?Mas|Tanyongmat';
  // ใน OSM แม่น้ำสายยาวมักเป็น relation ที่มีชื่อ แต่ทางน้ำย่อย (way) แต่ละช่วงไม่มีชื่อ → ต้องดึงสมาชิกของ relation ด้วย
  // และบางช่วงมีแต่ชื่อ name:th / name:en
  const Q = '[out:json][timeout:120];(' +
    'way["waterway"]["name"~"' + TH + '"]' + BB + ';' +
    'way["waterway"]["name:th"~"' + TH + '"]' + BB + ';' +
    'way["waterway"]["name:en"~"' + EN + '",i]' + BB + ';' +
    ')->.named;(' +
    'relation["waterway"]["name"~"' + TH + '"]' + BB + ';' +
    'relation["waterway"]["name:en"~"' + EN + '",i]' + BB + ';' +
    ')->.rels;way(r.rels)->.members;(.named;.members;);out geom;';
  const LINE_TYPES = /^(river|canal|stream|tidal_channel)$/;
  const EPS = 0.0012; // ~130 m · ลดจุดให้เส้นเบาแต่ยังลื่น

  function simplify(g) {
    if (g.length < 3) return g;
    const o = [g[0]];
    for (let i = 1; i < g.length - 1; i++) {
      const a = o[o.length - 1], b = g[i];
      if (Math.abs(a[0] - b[0]) > EPS || Math.abs(a[1] - b[1]) > EPS) o.push(b);
    }
    o.push(g[g.length - 1]);
    return o;
  }

  let _cache = null, _pending = null;
  async function getRivers() {
    if (_cache) return _cache;
    try { OLD_KEYS.forEach(k => localStorage.removeItem(k)); } catch (e) {}
    try { const c = localStorage.getItem(KEY); if (c) { _cache = JSON.parse(c); return _cache; } } catch (e) {}
    if (_pending) return _pending;
    _pending = (async () => {
      try {
        const res = await fetch(OVERPASS, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: Q });
        const j = await res.json();
        const seen = new Set();
        const out = (j.elements || [])
          .filter(w => w.type === 'way' && w.geometry && w.geometry.length > 1 && !seen.has(w.id) && seen.add(w.id))
          // เอาเฉพาะเส้นทางน้ำ ไม่เอาขอบตลิ่ง/พื้นที่น้ำ (สมาชิก relation รุ่นเก่ามี riverbank เป็นวงปิด)
          .filter(w => LINE_TYPES.test((w.tags && w.tags.waterway) || 'river'))
          .filter(w => { const a = w.geometry[0], b = w.geometry[w.geometry.length - 1]; return a.lat !== b.lat || a.lon !== b.lon; })
          .map(w => simplify(w.geometry.map(p => [+p.lat.toFixed(4), +p.lon.toFixed(4)])));
        if (out.length) { _cache = out; try { localStorage.setItem(KEY, JSON.stringify(out)); } catch (e) {} }
        return out;
      } catch (e) { return null; }
    })();
    return _pending;
  }

  // เส้นแม่น้ำ: มี casing (น้ำเงินเข้มหนา) + core (ฟ้าสว่าง) ให้เห็นเด่นบนพื้นแผนที่
  async function drawLeaflet(map) {
    if (!map || typeof L === 'undefined') return;
    const R = await getRivers();
    if (!R || !R.length) return;
    if (!map.getPane('rivers')) { map.createPane('rivers'); map.getPane('rivers').style.zIndex = 260; }
    R.forEach(line => {
      L.polyline(line, { pane: 'rivers', color: 'var(--signal-deep)', weight: 6, opacity: 0.5,  lineJoin: 'round', lineCap: 'round', interactive: false }).addTo(map);
      L.polyline(line, { pane: 'rivers', color: 'var(--signal)', weight: 3, opacity: 0.95, lineJoin: 'round', lineCap: 'round', interactive: false }).addTo(map);
    });
  }

  async function drawGoogle(gmap) {
    if (!gmap || typeof google === 'undefined') return;
    const R = await getRivers();
    if (!R || !R.length) return;
    R.forEach(line => {
      const path = line.map(p => ({ lat: p[0], lng: p[1] }));
      new google.maps.Polyline({ map: gmap, path, strokeColor: 'var(--signal-deep)', strokeOpacity: 0.5,  strokeWeight: 7, clickable: false, zIndex: 1 });
      new google.maps.Polyline({ map: gmap, path, strokeColor: 'var(--signal)', strokeOpacity: 0.95, strokeWeight: 3.5, clickable: false, zIndex: 2 });
    });
  }

  window.OMSRivers = { drawLeaflet, drawGoogle, getRivers };
})();
