' run-hidden.vbs — รัน run-auto.bat แบบไม่มีหน้าต่างเด้ง (ใช้กับ Task Scheduler)
Dim sh, fso, here
Set sh  = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
' 0 = ซ่อนหน้าต่าง, False = ไม่ต้องรอให้เสร็จ
sh.Run """" & here & "\run-auto.bat""", 0, False
