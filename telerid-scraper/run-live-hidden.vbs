' run-live-hidden.vbs - starts run-live.bat (live mode) with no window. Used by the "telerid live" task.
' Safe to call repeatedly (e.g. every 15 minutes): if live mode is already running, the new copy exits at once.
Dim sh, fso, here
Set sh  = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = here
' 0 = hidden window, False = do not wait
sh.Run "cmd.exe /c """"" & here & "\run-live.bat"" hidden""", 0, False
