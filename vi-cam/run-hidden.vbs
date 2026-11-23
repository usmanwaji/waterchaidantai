' run-hidden.vbs - runs run.bat with no console window. Used by the "vi-cam" scheduled task.
Dim sh, fso, here
Set sh  = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = here
' 0 = hidden window, True = wait until done
sh.Run "cmd.exe /c """ & here & "\run.bat""", 0, True
