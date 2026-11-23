# setup-task.ps1 — ตั้งงาน "vi-cam" ใน Task Scheduler: จับภาพ+ส่งขึ้นเว็บทุก 20 นาที ขณะผู้ใช้นี้ล็อกอินอยู่
# (ต้องรันแบบล็อกอินอยู่ เพราะจับภาพจากหน้าจอ) · รันซ้ำได้ จะแทนที่งานเดิม · ลบงาน: Unregister-ScheduledTask vi-cam
$vbs = Join-Path $PSScriptRoot 'run-hidden.vbs'
$action  = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$vbs`"" -WorkingDirectory $PSScriptRoot
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 20)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 5) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName 'vi-cam' -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force |
  Select-Object TaskName, State
