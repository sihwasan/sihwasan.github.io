' Sihwasan presbytery - outside security check (tools/security-watch)
' Task Scheduler runs this file every morning. It starts watch.js without a console window.
' Argument 0 (optional): full path of node.exe
Dim sh, fso, here, node
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
node = "node"
If WScript.Arguments.Count > 0 Then node = WScript.Arguments(0)
sh.CurrentDirectory = here
sh.Run """" & node & """ watch.js", 0, True
