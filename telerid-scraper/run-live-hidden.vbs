' run-live-hidden.vbs — รัน run-live.bat (โหมดสด) แบบไม่มีหน้าต่าง ใช้กับ Task Scheduler
' เรียกซ้ำได้ (เช่น ทุก 15 นาที) ถ้ารันอยู่แล้วตัวใหม่จะออกเอง ถ้าล่ม/รีสตาร์ทคอม รอบถัดไปจะเปิดให้ใหม่
Dim sh, fso, here
Set sh  = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
' 0 = ซ่อนหน้าต่าง, False = ไม่ต้องรอให้เสร็จ
sh.Run """" & here & "\run-live.bat"" hidden", 0, False
