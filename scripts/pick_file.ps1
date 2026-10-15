param(
    [string]$Title = "Chọn tệp cần dịch ngược"
)

Add-Type -AssemblyName System.Windows.Forms

$winWrapperCode = @"
using System;
using System.Windows.Forms;
using System.Runtime.InteropServices;

public class Win32WindowWrapper : IWin32Window {
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
    public IntPtr Handle { get { return GetForegroundWindow(); } }
}
"@
if (-not ([System.Management.Automation.PSTypeName]'Win32WindowWrapper').Type) {
    Add-Type -TypeDefinition $winWrapperCode -ReferencedAssemblies System.Windows.Forms
}

$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Title = $Title
$dialog.Filter = "Tất cả tệp hợp lệ (*.*)|*.*|Tệp thực thi (*.exe;*.dll)|*.exe;*.dll|Gói Electron (*.asar)|*.asar|Mã JavaScript (*.js)|*.js|Ứng dụng Android (*.apk)|*.apk"

$owner = New-Object Win32WindowWrapper
if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    Write-Output $dialog.FileName
}
