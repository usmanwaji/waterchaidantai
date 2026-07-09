// supabase/functions/notify-admin/index.ts
//
// Deno Edge Function — sends an informational email to the admin whenever a
// new user signs up and lands in "pending" status. This does NOT approve
// anyone by itself; approval happens on admin.html. See SETUP-GUIDE.md step 5
// for how to deploy this and set its two secrets (RESEND_API_KEY, WEBHOOK_SECRET).
//
// Deploy with:
//   supabase functions deploy notify-admin
//   supabase secrets set RESEND_API_KEY=re_xxxxxxxx WEBHOOK_SECRET=some-long-random-string ADMIN_EMAIL=newusmanwaji@gmail.com

const ADMIN_EMAIL = Deno.env.get("ADMIN_EMAIL") ?? "newusmanwaji@gmail.com";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET");
// Change this once you have a real domain verified in Resend (Resend requires
// the "from" address to be on a domain you verified there). Until then,
// Resend's shared "onboarding@resend.dev" sender works for testing.
const FROM_ADDRESS = Deno.env.get("FROM_ADDRESS") ?? "onboarding@resend.dev";
const ADMIN_DASHBOARD_URL = Deno.env.get("ADMIN_DASHBOARD_URL") ??
  "https://usmanwaji.github.io/waterchaidantai/admin.html";

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // Only the Postgres trigger (schema.sql, section 5) should be able to call
  // this function — it must present the shared secret we configured.
  const providedSecret = req.headers.get("x-webhook-secret");
  if (!WEBHOOK_SECRET || providedSecret !== WEBHOOK_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  if (!RESEND_API_KEY) {
    console.error("RESEND_API_KEY is not set");
    return new Response("Server not configured", { status: 500 });
  }

  let payload: { id?: string; email?: string; name?: string; created_at?: string };
  try {
    payload = await req.json();
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  const { email, name, created_at } = payload;

  const html = `
    <div style="font-family:sans-serif;font-size:14px;line-height:1.6;color:#222">
      <h2 style="color:#ea580c;margin:0 0 8px">มีผู้ใช้ใหม่รอการอนุมัติ</h2>
      <p>มีผู้สมัครสมาชิกใหม่ในระบบ Dashboard อุทกภัย และรอการอนุมัติสิทธิ์บันทึกข้อมูล</p>
      <table cellpadding="6" style="border-collapse:collapse;margin:12px 0">
        <tr><td style="color:#666">ชื่อ</td><td><b>${escapeHtml(name ?? "-")}</b></td></tr>
        <tr><td style="color:#666">อีเมล</td><td><b>${escapeHtml(email ?? "-")}</b></td></tr>
        <tr><td style="color:#666">เวลาสมัคร</td><td>${escapeHtml(created_at ?? "-")}</td></tr>
      </table>
      <p>กรุณาเข้าสู่ระบบที่หน้าผู้ดูแลระบบเพื่ออนุมัติหรือปฏิเสธคำขอนี้:</p>
      <p><a href="${ADMIN_DASHBOARD_URL}" style="background:#ea580c;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block">เปิดหน้าผู้ดูแลระบบ</a></p>
      <p style="color:#999;font-size:12px;margin-top:20px">อีเมลนี้เป็นการแจ้งเตือนเท่านั้น ไม่ใช่ลิงก์อนุมัติ — การอนุมัติทำได้จากหน้าผู้ดูแลระบบเท่านั้นเพื่อความปลอดภัย</p>
    </div>`;

  const resendRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `Dashboard อุทกภัย <${FROM_ADDRESS}>`,
      to: [ADMIN_EMAIL],
      subject: `[รออนุมัติ] ผู้ใช้ใหม่: ${name ?? email ?? "ไม่ทราบชื่อ"}`,
      html,
    }),
  });

  if (!resendRes.ok) {
    const errText = await resendRes.text();
    console.error("Resend API error:", resendRes.status, errText);
    return new Response("Failed to send email", { status: 502 });
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  });
});

function escapeHtml(s: string): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string)
  );
}
