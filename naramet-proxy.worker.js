/*
  naramet proxy — Cloudflare Worker
  ------------------------------------------------------------------
  ส่งต่อเว็บสถานีอุตุนิยมวิทยานราธิวาส (https://naramet.semet.uk) ทั้งโดเมน ให้การ์ด
  "ปริมาณฝนสะสม วันนี้ · เมื่อวาน" ใน index.html ฝังหน้า /rainfall เป็น iframe ที่ src ชี้มาที่ worker นี้

  เดิมหน้าแรกดึงจาก naramet.pages.dev แต่ต้นทางย้ายมา naramet.semet.uk (pages.dev ตอนนี้ 301 มาที่นี่)
  ซึ่งไม่เปิด CORS ไม่ยอมให้ฝังในกรอบ (X-Frame-Options) และเปลี่ยนเป็นแอป React/Vite (HTML เปล่า <div id="root"> + สคริปต์
  router ของแอปอ่าน path /rainfall จาก location จึงต้องเปิดจาก URL จริง ไม่ใช่ srcdoc)
  worker ตัดหัวห้ามฝังกรอบ/คุกกี้ เปิด CORS เปลี่ยนลิงก์แบบเต็ม https://naramet.semet.uk/... (และ naramet.pages.dev)
  ใน HTML/JS ให้ชี้มาที่ worker และแทรกสคริปต์ EMBED ต้น <head> ของหน้า HTML (ดูด้านล่าง)

  วิธี deploy (ฟรี ~5 นาที)
  1) เข้า https://dash.cloudflare.com  →  Workers & Pages  →  Create  →  Create Worker
  2) ตั้งชื่อ  naramet-proxy  →  Deploy
  3) กด Edit code  →  ลบโค้ดตัวอย่าง  →  วางไฟล์นี้ทั้งหมด  →  Save and deploy
  4) จะได้ URL  https://naramet-proxy.<ชื่อบัญชี>.workers.dev  (ตรงกับ NARAMET_PROXY ใน index.html แล้ว)

  ทดสอบว่าใช้ได้:  เปิด  https://<worker>/rainfall  ต้องเห็นหน้าปริมาณฝนสะสม
  ------------------------------------------------------------------
*/

const UPSTREAM = 'https://naramet.semet.uk';
const OLD_HOSTS = /https?:\/\/naramet\.(?:semet\.uk|pages\.dev)/g;   // ลิงก์แบบเต็มที่ต้องชี้มาที่ worker
const CACHE_SECONDS = 120;         // ฝนสะสมต้นทางอัปเดตเป็นรอบ ๆ แคชสั้น ๆ พอกันยิงต้นทางซ้ำ
// แทรกต้น <head> ก่อนสคริปต์ของแอป:
// - ปิดการลงทะเบียน service worker ของแอป (ไม่งั้นจะแคชหน้าไว้ที่โดเมน worker แล้วเสิร์ฟหน้าที่ไม่มีสคริปต์นี้)
// - รายงานหน้าแรกเมื่อแอปแสดงผลแล้ว ({naramet:'ok'}) · 25 วิแล้วยังว่าง ส่ง {naramet:'fail'} พร้อมคำขอที่ล้มเหลว
//   (ยังเฝ้าต่อถึง 2 นาที ถ้าแอปขึ้นทีหลังก็ส่ง ok ตามไป หน้าแรกจะแสดงกรอบอีกครั้ง)
// - ซ่อนเมนูบนสุดของต้นทาง: header/nav ตัวแรกที่อยู่นอก <main> ชิดขอบบน มีลิงก์ และไม่มีแผนที่ข้างใน (ซ่อนตัวเดียว)
// - เลือกแท็บ "นราธิวาส" ครั้งเดียว (ปุ่มที่ข้อความตรงพอดีและมองเห็นอยู่ ไม่กดลิงก์ จะได้ไม่พาออกจากหน้า)
// ไม่ผูกกับ id/class ของต้นทาง เพราะแอปสร้าง DOM เองและเปลี่ยนได้ทุกรอบ build
const EMBED = `<script>(function(){
try{if(navigator.serviceWorker)navigator.serviceWorker.register=function(){return new Promise(function(){});};}catch(e){}
var L=[],f=window.fetch,t0=Date.now(),ok=false,bad=false,nav=false,tab=false;
window.fetch=function(u){return f.apply(this,arguments).then(function(r){if(!r.ok)L.push(r.status+' '+r.url);return r;},function(e){L.push('fetch '+(u&&u.url||u)+' '+e);throw e;});};
addEventListener('error',function(e){var t=e.target;L.push(t&&t!==window?'load '+(t.src||t.href):'js '+e.message);},true);
addEventListener('unhandledrejection',function(e){L.push('js '+e.reason);});
function post(m){if(parent!==window)parent.postMessage(m,'*');}
function hideNav(){var a=document.querySelectorAll('header,nav,.navbar,[role=navigation]');
for(var i=0;i<a.length;i++){var e=a[i],r=e.getBoundingClientRect();
if(e.closest('main')||!r.height||r.top>100||r.height>200||!e.querySelector('a[href]')||e.querySelector('canvas,.leaflet-container,.maplibregl-map'))continue;
e.style.setProperty('display','none','important');return true;}return false;}
function pickTab(){var a=(document.querySelector('main')||document).querySelectorAll('button,[role=tab]');
for(var i=0;i<a.length;i++){if(a[i].offsetParent&&(a[i].innerText||'').trim()==='นราธิวาส'){a[i].click();return true;}}return false;}
var iv=setInterval(function(){var root=document.getElementById('root');
if(!ok&&root&&root.children.length){ok=true;post({naramet:'ok'});}
if(ok&&!nav)nav=hideNav();if(ok&&!tab)tab=pickTab();
var t=Date.now()-t0;if(!ok&&!bad&&t>25000){bad=true;post({naramet:'fail',why:'แอปต้นทางไม่แสดงผลใน 25 วิ · '+L.slice(0,4).join(' | ')});}
if(t>120000||(ok&&nav&&tab))clearInterval(iv);},500);
})();</script>`;
const UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36';

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors() });
    if (!['GET', 'HEAD', 'POST'].includes(request.method)) return new Response('Method Not Allowed', { status: 405, headers: cors() });

    // ส่งต่อเฉพาะโดเมน naramet.semet.uk เท่านั้น (ทุก path)
    const url = new URL(request.url);
    const target = UPSTREAM + url.pathname + url.search;
    const get = request.method !== 'POST';
    const headers = { 'User-Agent': UA, 'Accept': request.headers.get('Accept') || '*/*', 'Referer': UPSTREAM + '/rainfall' };
    const lang = request.headers.get('Accept-Language'), type = request.headers.get('Content-Type');
    if (lang) headers['Accept-Language'] = lang;
    if (type) headers['Content-Type'] = type;

    let upstream;
    try {
      upstream = await fetch(target, {
        method: request.method, headers,
        body: get ? undefined : await request.arrayBuffer(),
        cf: get ? { cacheTtl: CACHE_SECONDS, cacheEverything: true } : undefined
      });
    } catch (e) {
      return new Response('Upstream fetch failed', { status: 502, headers: cors() });
    }

    const out = new Headers(upstream.headers);
    for (const h of ['set-cookie', 'x-frame-options', 'content-security-policy', 'content-length']) out.delete(h);
    for (const [k, v] of Object.entries(cors())) out.set(k, v);
    if (get) out.set('Cache-Control', `public, max-age=${CACHE_SECONDS}`);
    out.set('X-Robots-Tag', 'noindex, nofollow');   // เป็นสำเนาของเว็บคนอื่น ไม่ให้เครื่องมือค้นหาเก็บ

    // HTML/JS: เปลี่ยนลิงก์แบบเต็มของต้นทางให้ชี้มาที่ worker (fetch ข้ามโดเมนจากกรอบจะติด CORS อีก) · HTML แทรก EMBED
    const ct = out.get('content-type') || '';
    if (request.method !== 'HEAD' && /text\/html|javascript/.test(ct)) {
      let text = (await upstream.text()).replace(OLD_HOSTS, url.origin);
      if (ct.includes('text/html')) text = text.replace(/<head[^>]*>/i, (m) => m + EMBED);
      return new Response(text, { status: upstream.status, headers: out });
    }
    return new Response(upstream.body, { status: upstream.status, headers: out });
  }
};

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Accept, Content-Type'
  };
}
