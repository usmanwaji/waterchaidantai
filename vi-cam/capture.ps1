<#
  capture.ps1 — จับภาพกล้อง CCTV เทศบาลจากหน้าต่าง VI MonitorPlus ที่เปิดค้างไว้ บันทึกเป็น JPG ลงโฟลเดอร์ out\
  (VI ใช้โปรโตคอลของตัวเอง ดึงภาพจากกล้องตรง ๆ ไม่ได้ เพราะกล้องอยู่ IP ภายในของเทศบาล)

  VI วาดวิดีโอด้วย DirectX ซึ่ง PrintWindow ได้ภาพดำ จึงต้องจับจากหน้าจอจริง:
    ยกหน้าต่าง VI ขึ้นบนสุดชั่วคราว (ไม่แย่งโฟกัสคีย์บอร์ด) → จับเฉพาะกรอบวิดีโอ → วางกลับใต้หน้าต่างที่ใช้อยู่
  เงื่อนไข: หน้าจอต้องไม่ล็อก/ไม่ Sleep และเปิดกล้องไว้ในแท็บแบบ 1 กล้อง
  ภาพดำ/ไอคอนปลั๊ก "ไม่มีสัญญาณ" ไม่บันทึกทับภาพเดิม

  exit 0 = ได้ภาพใหม่ · 2 = ไม่มีภาพ (ไม่ต้อง publish) · 1 = ผิดพลาด
#>
param([string]$OutDir = (Join-Path $PSScriptRoot 'out'))
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;

public static class ViCap {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr p, EnumProc f, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [StructLayout(LayoutKind.Sequential)] struct RECT { public int L, T, R, B; }

  const uint NOSIZE_NOMOVE_NOACTIVATE = 0x0001 | 0x0002 | 0x0010;
  static long Area(IntPtr h) { RECT r; GetWindowRect(h, out r); return (long)(r.R - r.L) * (r.B - r.T); }

  // หน้าต่างหลัก = หน้าต่างที่ใหญ่ที่สุดของโปรเซส (หน้าล็อกอินก็ชื่อ "VI MonitorPlus" แต่เล็กกว่ามาก)
  public static IntPtr FindMain(uint[] pids) {
    IntPtr best = IntPtr.Zero; long bestArea = 0;
    EnumWindows((h, l) => {
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (Array.IndexOf(pids, pid) < 0 || !IsWindowVisible(h)) return true;
      long a = IsIconic(h) ? 1 : Area(h);
      if (a > bestArea) { bestArea = a; best = h; }
      return true;
    }, IntPtr.Zero);
    return best;
  }

  // กรอบวิดีโอ = หน้าต่างลูกคลาส WindowsForms10.STATIC ที่ใหญ่ที่สุด (แท็บแบบ 1 กล้องมีอันเดียว)
  public static IntPtr FindVideo(IntPtr main) {
    IntPtr best = IntPtr.Zero; long bestArea = 0;
    EnumChildWindows(main, (h, l) => {
      var s = new StringBuilder(256); GetClassName(h, s, 256);
      if (!IsWindowVisible(h) || !s.ToString().Contains(".STATIC.")) return true;
      long a = Area(h);
      if (a > bestArea) { bestArea = a; best = h; }
      return true;
    }, IntPtr.Zero);
    return best;
  }

  // ยกหน้าต่างขึ้นบนสุดโดยไม่แย่งโฟกัส จับภาพจากหน้าจอ แล้ววางกลับไว้ใต้หน้าต่างที่ผู้ใช้กำลังใช้
  public static Bitmap Grab(IntPtr main, IntPtr video, int settleMs) {
    IntPtr prev = GetForegroundWindow();
    SetWindowPos(main, new IntPtr(-1), 0, 0, 0, 0, NOSIZE_NOMOVE_NOACTIVATE);       // HWND_TOPMOST
    try {
      System.Threading.Thread.Sleep(settleMs);
      RECT r; GetWindowRect(video, out r);
      var bmp = new Bitmap(r.R - r.L, r.B - r.T, PixelFormat.Format32bppArgb);
      using (var g = Graphics.FromImage(bmp)) g.CopyFromScreen(r.L, r.T, 0, 0, bmp.Size);
      return bmp;
    } finally {
      SetWindowPos(main, new IntPtr(-2), 0, 0, 0, 0, NOSIZE_NOMOVE_NOACTIVATE);     // HWND_NOTOPMOST
      if (prev != IntPtr.Zero && prev != main) SetWindowPos(main, prev, 0, 0, 0, 0, NOSIZE_NOMOVE_NOACTIVATE);
    }
  }

  // จำนวนระดับความสว่างที่มีพิกเซล >= 0.1% · ภาพจริง (รวมกลางคืนขาวดำ) มีหลายสิบถึงหลายร้อยระดับ
  // ภาพดำ/ไอคอนปลั๊กของ VI มีไม่กี่ระดับ
  public static int Levels(Bitmap b) {
    var d = b.LockBits(new Rectangle(0, 0, b.Width, b.Height), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
    var px = new byte[d.Stride * b.Height];
    Marshal.Copy(d.Scan0, px, 0, px.Length);
    b.UnlockBits(d);
    var hist = new int[256]; int n = 0;
    for (int y = 0; y < b.Height; y++)
      for (int x = 0; x < b.Width; x++) {
        int o = y * d.Stride + x * 4;
        hist[(px[o + 2] * 299 + px[o + 1] * 587 + px[o] * 114) / 1000]++; n++;
      }
    int k = 0; foreach (var c in hist) if (c >= Math.Max(1, n / 1000)) k++;
    return k;
  }
}
'@

function Save-Jpeg([System.Drawing.Bitmap]$bmp, [string]$path, [int]$maxW = 1280) {
  $w = [Math]::Min($maxW, $bmp.Width); $h = [int]($bmp.Height * $w / $bmp.Width)
  $out = New-Object System.Drawing.Bitmap $w, $h
  $g = [System.Drawing.Graphics]::FromImage($out)
  $g.InterpolationMode = 'HighQualityBicubic'
  $g.DrawImage($bmp, 0, 0, $w, $h); $g.Dispose()
  $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object MimeType -eq 'image/jpeg'
  $ep = New-Object System.Drawing.Imaging.EncoderParameters 1
  $ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), 80L
  $tmp = "$path.tmp"
  $out.Save($tmp, $codec, $ep); $out.Dispose()
  Move-Item -Force $tmp $path
}

$stamp = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
function NoImage([string]$why) { Write-Output "$stamp ไม่มีภาพ: $why"; exit 2 }

New-Item -ItemType Directory -Force $OutDir | Out-Null
$cam = (Get-Content (Join-Path $PSScriptRoot 'cams.json') -Raw -Encoding UTF8 | ConvertFrom-Json).cams[0]

$procs = @(Get-Process VIMonitorPlus -ErrorAction SilentlyContinue)
if (-not $procs.Count) { NoImage 'ไม่ได้เปิด VI MonitorPlus' }
$main = [ViCap]::FindMain([uint32[]]($procs | ForEach-Object { [uint32]$_.Id }))
if ($main -eq [IntPtr]::Zero) { NoImage 'หาหน้าต่าง VI MonitorPlus ไม่เจอ' }
if ([ViCap]::IsIconic($main)) {
  [ViCap]::ShowWindow($main, 4) | Out-Null   # SW_SHOWNOACTIVATE: คืนขนาดโดยไม่แย่งโฟกัส
  Start-Sleep -Seconds 3
}
$video = [ViCap]::FindVideo($main)
if ($video -eq [IntPtr]::Zero) { NoImage 'ไม่พบกรอบวิดีโอ (ยังไม่ได้ล็อกอิน หรือไม่ได้เปิดกล้องในแท็บ?)' }

# ต้องเป็นกล้องที่อนุญาตเท่านั้น: ชื่อแท็บที่เปิดอยู่เปลี่ยนตามกล้องที่ลากมาวาง
# (มีคนเปิดกล้องอื่นดูชั่วคราว → ข้ามรอบนี้ ไม่ส่งภาพกล้องอื่นขึ้นไปในชื่อกล้องนี้)
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$A = [System.Windows.Automation.AutomationElement]
$tabs = @($A::FromHandle($main).FindAll([System.Windows.Automation.TreeScope]::Descendants,
  [System.Windows.Automation.PropertyCondition]::new($A::ControlTypeProperty, [System.Windows.Automation.ControlType]::TabItem)))
$open = @($tabs | Where-Object { try { $_.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Current.IsSelected } catch { $false } })
if ($tabs.Count -eq 1) { $open = $tabs }
$openName = if ($open.Count) { $open[0].Current.Name } else { '' }
if (-not $openName.Contains($cam.match)) { NoImage "แท็บที่เปิดอยู่คือ '$openName' ไม่ใช่ $($cam.match)" }

try { $bmp = [ViCap]::Grab($main, $video, 800) }
catch { NoImage "จับหน้าจอไม่ได้ (หน้าจอล็อก/Sleep?) $($_.Exception.Message)" }
try {
  $levels = [ViCap]::Levels($bmp)
  if ($bmp.Width -lt 320 -or $levels -lt 24) { NoImage "ภาพ $($bmp.Width)x$($bmp.Height) ระดับสี $levels (กล้องหลุด/ภาพดำ?)" }
  # ย่อตาม scale ใน cams.json (0.5 = ครึ่งหนึ่ง): พอเห็นระดับน้ำ แต่ไม่เห็นรายละเอียดคนในภาพ
  Save-Jpeg $bmp (Join-Path $OutDir "$($cam.id).jpg") ([int]($bmp.Width * $(if ($cam.scale) { $cam.scale } else { 1 })))
  $now = (Get-Date).ToUniversalTime().ToString('o')
  $meta = [ordered]@{
    updated = $now
    cams    = @([ordered]@{ id = $cam.id; name = $cam.name; lat = $cam.lat; lon = $cam.lon; file = "$($cam.id).jpg"; capturedAt = $now })
  }
  [IO.File]::WriteAllText((Join-Path $OutDir 'cams.json'), ($meta | ConvertTo-Json -Depth 5), (New-Object System.Text.UTF8Encoding $false))
  Write-Output "$stamp ได้ภาพ $($cam.id) $($bmp.Width)x$($bmp.Height) ระดับสี $levels"
  exit 0
} finally { $bmp.Dispose() }
