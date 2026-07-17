/* js/rivers.js — วาดคลองอู่ตะเภาและคลองสาขา/คลองระบายน้ำ ร.1 ลุ่มน้ำหาดใหญ่ เป็นเส้นสีน้ำเงินหนา
 * ข้อมูลจริงจาก OpenStreetMap (คลองอู่ตะเภา คลองสาขา และคลองระบายน้ำ ร.1)
 * - ดึงครั้งแรกจาก Overpass API แล้วแคชใน localStorage (แม่น้ำแทบไม่เปลี่ยน)
 * - ครั้งต่อไปวาดทันทีจากแคช ไม่พึ่ง network
 * ใช้: window.OMSRivers.drawLeaflet(map)  หรือ  window.OMSRivers.drawGoogle(gMap)
 */
(function () {
  'use strict';
  const KEY = 'oms_rivers_hatyai_v2';
  const OVERPASS = 'https://overpass-api.de/api/interpreter';
  const Q = '[out:json][timeout:120];(way["waterway"]["name"~"อู่ตะเภา|ระบายน้ำ ร.1|ภูมินาถดำริ|คลองวาด|คลองหวะ|คลองเตย|คลองต่ำ"](6.30,99.95,7.35,100.75););out geom;';
  const EPS = 0.0012; // ~130 m — ลดจุดให้เส้นเบาแต่ยังลื่น

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
    try { const c = localStorage.getItem(KEY); if (c) { _cache = JSON.parse(c); return _cache; } } catch (e) {}
    if (_pending) return _pending;
    _pending = (async () => {
      try {
        const res = await fetch(OVERPASS, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: Q });
        const j = await res.json();
        const out = (j.elements || [])
          .filter(w => w.geometry && w.geometry.length > 1)
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
      L.polyline(line, { pane: 'rivers', color: '#0a3d91', weight: 6, opacity: 0.5,  lineJoin: 'round', lineCap: 'round', interactive: false }).addTo(map);
      L.polyline(line, { pane: 'rivers', color: '#1e73e8', weight: 3, opacity: 0.95, lineJoin: 'round', lineCap: 'round', interactive: false }).addTo(map);
    });
  }

  async function drawGoogle(gmap) {
    if (!gmap || typeof google === 'undefined') return;
    const R = await getRivers();
    if (!R || !R.length) return;
    R.forEach(line => {
      const path = line.map(p => ({ lat: p[0], lng: p[1] }));
      new google.maps.Polyline({ map: gmap, path, strokeColor: '#0a3d91', strokeOpacity: 0.5,  strokeWeight: 7, clickable: false, zIndex: 1 });
      new google.maps.Polyline({ map: gmap, path, strokeColor: '#1e73e8', strokeOpacity: 0.95, strokeWeight: 3.5, clickable: false, zIndex: 2 });
    });
  }

  window.OMSRivers = { drawLeaflet, drawGoogle, getRivers };
})();
