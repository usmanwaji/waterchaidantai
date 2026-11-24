<#
  capture.ps1 — จับภาพกล้อง CCTV เทศบาลจากหน้าต่าง VI MonitorPlus ที่เปิดค้างไว้ บันทึกเป็น JPG ลงโฟลเดอร์ out\
  (VI ใช้โปรโตคอลของตัวเอง ดึงภาพจากกล้องตรง ๆ ไม่ได้ เพราะกล้องอยู่ IP ภายในของเทศบาล)

  VI วาดวิดีโอด้วย DirectX ซึ่ง PrintWindow ได้ภาพดำ จึงอ่านพิกเซลจากกรอบวิดีโอโดยตรง (BitBlt จาก DC ของกรอบ)
  ไม่ต้องยกหน้าต่าง และไม่ติดป๊อปอัปที่ลอยทับ · ถ้าได้ภาพดำ ใช้ทางสำรอง: ยก VI ขึ้นบนสุดชั่วคราว แล้วจับจากหน้าจอ
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

  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  public static string Title(IntPtr h) { var s = new StringBuilder(512); GetWindowText(h, s, 512); return s.ToString(); }

  // หน้าต่างระดับบนทุกบานของ VI: หน้าต่างหลัก + หน้าต่างกล้องที่ป๊อปออกมา (ปุ่ม ⧉ บนแท็บ)
  public static IntPtr[] TopWindows(uint[] pids) {
    var list = new System.Collections.Generic.List<IntPtr>();
    EnumWindows((h, l) => {
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (Array.IndexOf(pids, pid) >= 0 && IsWindowVisible(h)) list.Add(h);
      return true;
    }, IntPtr.Zero);
    return list.ToArray();
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

  [DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr h);
  [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr h, IntPtr dc);
  [DllImport("gdi32.dll")] static extern bool BitBlt(IntPtr d, int x, int y, int w, int h, IntPtr s, int sx, int sy, int rop);

  // อ่านพิกเซลจากกรอบวิดีโอโดยตรง: ได้ภาพแม้มีหน้าต่างอื่นบัง และไม่ติดป๊อปอัป/พรีวิวทาสก์บาร์ที่ลอยทับหน้าจอ
  public static Bitmap Direct(IntPtr video) {
    RECT r; GetWindowRect(video, out r);
    var bmp = new Bitmap(r.R - r.L, r.B - r.T, PixelFormat.Format32bppArgb);
    using (var g = Graphics.FromImage(bmp)) {
      IntPtr dst = g.GetHdc(), src = GetDC(video);
      BitBlt(dst, 0, 0, bmp.Width, bmp.Height, src, 0, 0, 0x00CC0020 | 0x40000000);   // SRCCOPY | CAPTUREBLT
      ReleaseDC(video, src); g.ReleaseHdc(dst);
    }
    return bmp;
  }

  // ทางสำรอง: ยกหน้าต่างขึ้นบนสุดโดยไม่แย่งโฟกัส จับภาพจากหน้าจอ แล้ววางกลับไว้ใต้หน้าต่างที่ผู้ใช้กำลังใช้
  // (ติดสิ่งที่ลอยทับหน้าจอได้ เช่นพรีวิวทาสก์บาร์/การแจ้งเตือน)
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

  // คลิกขวาจริงที่ตำแหน่งบนจอ (ใช้เปิดเมนูของกล้องในรายการ) แล้วคืนเคอร์เซอร์ที่เดิม
  [StructLayout(LayoutKind.Sequential)] struct POINT { public int X, Y; }
  [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] static extern void mouse_event(uint f, int dx, int dy, uint d, IntPtr e);
  public static void RightClick(int x, int y) {
    POINT old; GetCursorPos(out old);
    SetCursorPos(x, y); System.Threading.Thread.Sleep(150);
    mouse_event(0x0008, 0, 0, 0, IntPtr.Zero); mouse_event(0x0010, 0, 0, 0, IntPtr.Zero);   // RIGHTDOWN, RIGHTUP
    System.Threading.Thread.Sleep(150);
    SetCursorPos(old.X, old.Y);
  }
  public static void Topmost(IntPtr h, bool on) {
    SetWindowPos(h, new IntPtr(on ? -1 : -2), 0, 0, 0, 0, NOSIZE_NOMOVE_NOACTIVATE);
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
  [IO.File]::Copy($tmp, $path, $true); [IO.File]::Delete($tmp)
}

$stamp = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
function Log([string]$m) { [Console]::Out.WriteLine("$stamp $m") }   # ไม่ปนกับค่าที่ฟังก์ชันคืน

New-Item -ItemType Directory -Force $OutDir | Out-Null
$cams = @((Get-Content (Join-Path $PSScriptRoot 'cams.json') -Raw -Encoding UTF8 | ConvertFrom-Json).cams)

$procs = @(Get-Process VIMonitorPlus -ErrorAction SilentlyContinue)
if (-not $procs.Count) { Log 'ไม่มีภาพ: ไม่ได้เปิด VI MonitorPlus'; exit 2 }

# ชื่อกล้องที่หน้าต่างนั้นแสดงอยู่ = ชื่อแท็บที่เลือกอยู่ (เปลี่ยนตามกล้องที่ลากมาวาง) · ไม่มีแท็บใช้ชื่อหน้าต่าง
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$A = [System.Windows.Automation.AutomationElement]
function Get-ViewName([IntPtr]$win) {
  $tabs = @($A::FromHandle($win).FindAll([System.Windows.Automation.TreeScope]::Descendants,
    [System.Windows.Automation.PropertyCondition]::new($A::ControlTypeProperty, [System.Windows.Automation.ControlType]::TabItem)))
  $open = @($tabs | Where-Object { try { $_.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Current.IsSelected } catch { $false } })
  if ($tabs.Count -eq 1) { $open = $tabs }
  if ($open.Count) { return $open[0].Current.Name }
  return [ViCap]::Title($win)
}

$pids = [uint32[]]($procs | ForEach-Object { [uint32]$_.Id })
function Find-First($el, $type, [string]$name) {
  $cond = [System.Windows.Automation.PropertyCondition]::new($A::ControlTypeProperty, $type)
  foreach ($e in $el.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)) { if ($e.Current.Name.Contains($name)) { return $e } }
}

# หน้าต่าง VI ทุกบานที่มีกรอบวิดีโอ (หน้าต่างหลัก + หน้าต่างกล้องที่ป๊อปออกมา)
function Get-Views {
  # หน้าต่างที่ถูกย่อ: คืนขนาดก่อน (SW_SHOWNOACTIVATE ไม่แย่งโฟกัส) แล้วรอให้แท็บกับวิดีโอวาดใหม่
  # (รอแค่ 3 วิ เคยได้ชื่อแท็บว่าง/ภาพดำ → เปิดกล้องซ้ำและข้ามรอบ)
  $restored = $false
  foreach ($win in [ViCap]::TopWindows($pids)) {
    if ([ViCap]::IsIconic($win)) { [ViCap]::ShowWindow($win, 4) | Out-Null; $restored = $true }
  }
  if ($restored) { Start-Sleep -Seconds 10 }
  foreach ($win in [ViCap]::TopWindows($pids)) {
    $video = [ViCap]::FindVideo($win)
    if ($video -eq [IntPtr]::Zero) { continue }
    [pscustomobject]@{ win = $win; video = $video; name = (Get-ViewName $win) }
  }
}

# เปิดกล้องที่ยังไม่ได้เปิด (เช่นหลังคอมรีสตาร์ทแล้วเพิ่งล็อกอิน): คลิกขวาที่ชื่อกล้องในรายการ Servers → View in New Window
# ยก VI ขึ้นบนสุดชั่วคราวให้คลิกโดนรายการ แล้ววางกลับ · ทำเฉพาะตอนที่กล้องไม่ได้เปิดอยู่ ไม่รบกวนรอบปกติ
function Open-Cam($cam) {
  $main = [ViCap]::TopWindows($pids) | Where-Object { Find-First $A::FromHandle($_) ([System.Windows.Automation.ControlType]::Group) 'Servers' } | Select-Object -First 1
  if (-not $main) { Log "เปิด $($cam.id) เองไม่ได้: ยังไม่ได้ล็อกอิน VI (ไม่พบรายการ Servers)"; return }
  $root = $A::FromHandle($main)
  $servers = Find-First $root ([System.Windows.Automation.ControlType]::Group) 'Servers'
  try { $servers.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern).Expand() } catch {}
  Start-Sleep -Milliseconds 500
  $item = Find-First $root ([System.Windows.Automation.ControlType]::TreeItem) $cam.match
  if (-not $item) { Log "เปิด $($cam.id) เองไม่ได้: ไม่พบ $($cam.match) ในรายการ Servers"; return }
  try { $item.GetCurrentPattern([System.Windows.Automation.ScrollItemPattern]::Pattern).ScrollIntoView() } catch {}
  try { $item.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Select() } catch {}
  Start-Sleep -Milliseconds 500
  $r = $item.Current.BoundingRectangle
  $panel = $servers.Current.BoundingRectangle
  [ViCap]::Topmost($main, $true)
  try {
    Start-Sleep -Milliseconds 300
    [ViCap]::RightClick([int][Math]::Min($r.X + 100, $panel.Right - 20), [int]($r.Y + $r.Height / 2))
    Start-Sleep -Milliseconds 800
    $menu = foreach ($w in [ViCap]::TopWindows($pids)) { Find-First $A::FromHandle($w) ([System.Windows.Automation.ControlType]::MenuItem) 'View in New Window' }
    $menu = @($menu)[0]
    if (-not $menu) { Log "เปิด $($cam.id) เองไม่ได้: เมนู View in New Window ไม่ขึ้น"; return }
    $menu.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
    Log "เปิดกล้อง $($cam.id) ในหน้าต่างใหม่ให้แล้ว"
  } finally { [ViCap]::Topmost($main, $false) }
  Start-Sleep -Seconds 8   # รอวิดีโอเริ่มเล่น
}

$views = @(Get-Views)
$missing = @($cams | Where-Object { $c = $_; -not ($views | Where-Object { $_.name -and $_.name.Contains($c.match) }) })
if ($missing.Count) {
  foreach ($cam in $missing) { Open-Cam $cam }
  $views = @(Get-Views)
}

function Save-Cam($cam, $view) {
  $bmp = [ViCap]::Direct($view.video); $how = 'direct'
  if ([ViCap]::Levels($bmp) -lt 24) {   # วิดีโอเพิ่งเริ่ม/เพิ่งคืนขนาด อาจยังดำอยู่ → รออีกนิดแล้วลองใหม่
    $bmp.Dispose(); Start-Sleep -Seconds 5; $bmp = [ViCap]::Direct($view.video)
  }
  if ([ViCap]::Levels($bmp) -lt 24) {
    $bmp.Dispose(); $how = 'screen'
    try { $bmp = [ViCap]::Grab($view.win, $view.video, 800) }
    catch { Log "ข้าม $($cam.id): จับหน้าจอไม่ได้ (หน้าจอล็อก/Sleep?) $($_.Exception.Message)"; return $false }
  }
  try {
    $levels = [ViCap]::Levels($bmp)
    if ($bmp.Width -lt 320 -or $levels -lt 24) { Log "ข้าม $($cam.id): ภาพ $($bmp.Width)x$($bmp.Height) ระดับสี $levels (กล้องหลุด/ภาพดำ?)"; return $false }
    # ครอปตาม crop (สัดส่วน 0–1 ของภาพเต็ม) ให้เหลือแค่พื้นที่ดูระดับน้ำ ไม่ติดบ้านคน
    if ($cam.crop) {
      $W = $bmp.Width; $H = $bmp.Height
      $rc = [System.Drawing.Rectangle]::FromLTRB([int]($W * $cam.crop.left), [int]($H * $cam.crop.top), [int]($W * $cam.crop.right), [int]($H * $cam.crop.bottom))
      $full = $bmp; $bmp = $full.Clone($rc, $full.PixelFormat); $full.Dispose()
    }
    # ย่อตาม scale (0.5 = ครึ่งหนึ่ง): พอเห็นระดับน้ำ แต่ไม่เห็นรายละเอียดคนในภาพ
    Save-Jpeg $bmp (Join-Path $OutDir "$($cam.id).jpg") ([int]($bmp.Width * $(if ($cam.scale) { $cam.scale } else { 1 })))
    Log "ได้ภาพ $($cam.id) $($bmp.Width)x$($bmp.Height) ระดับสี $levels ($how)"
    return $true
  } finally { $bmp.Dispose() }
}

# กล้องที่ไม่ได้เปิดอยู่ (มีคนเปิดกล้องอื่นดูชั่วคราว) ข้ามไป ไม่ส่งภาพกล้องอื่นขึ้นไปในชื่อกล้องนี้
# และคงภาพ+เวลาถ่ายเดิมไว้ในรายการ ให้เว็บยังแสดงภาพล่าสุดพร้อมป้ายภาพเก่า
$metaPath = Join-Path $OutDir 'cams.json'
$prev = @{}
if (Test-Path $metaPath) { (Get-Content $metaPath -Raw -Encoding UTF8 | ConvertFrom-Json).cams | ForEach-Object { $prev[$_.id] = $_.capturedAt } }
$got = 0
$entries = foreach ($cam in $cams) {
  $view = $views | Where-Object { $_.name -and $_.name.Contains($cam.match) } | Select-Object -First 1
  $at = $prev[$cam.id]
  if (-not $view) { Log "ข้าม $($cam.id): ไม่ได้เปิด $($cam.match) ใน VI (เปิดอยู่: $(($views | ForEach-Object { $_.name }) -join ' | '))" }
  elseif (Save-Cam $cam $view) { $at = (Get-Date).ToUniversalTime().ToString('o'); $got++ }
  if ($at -and (Test-Path (Join-Path $OutDir "$($cam.id).jpg"))) {
    [ordered]@{ id = $cam.id; name = $cam.name; lat = $cam.lat; lon = $cam.lon; file = "$($cam.id).jpg"; capturedAt = $at }
  }
}
if (-not $got) { exit 2 }
$meta = [ordered]@{ updated = (Get-Date).ToUniversalTime().ToString('o'); cams = @($entries) }
[IO.File]::WriteAllText($metaPath, ($meta | ConvertTo-Json -Depth 5), (New-Object System.Text.UTF8Encoding $false))
exit 0
