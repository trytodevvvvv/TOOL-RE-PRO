param(
    [string]$Title = "Lưu gói ASAR mới (Save Module)",
    [string]$InitialDir = "",
    [string]$DefaultFileName = "app_patched.asar",
    [string]$Filter = "Electron ASAR Package (*.asar)|*.asar|All Files (*.*)|*.*"
)

Add-Type -AssemblyName System.Windows.Forms

$winWrapperCode = @"
using System;
using System.Windows.Forms;
using System.Runtime.InteropServices;

public class Win32WindowWrapperSave : IWin32Window {
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
    public IntPtr Handle { get { return GetForegroundWindow(); } }
}
"@
if (-not ([System.Management.Automation.PSTypeName]'Win32WindowWrapperSave').Type) {
    Add-Type -TypeDefinition $winWrapperCode -ReferencedAssemblies System.Windows.Forms
}

$dialog = New-Object System.Windows.Forms.SaveFileDialog
$dialog.Title = $Title
$dialog.Filter = $Filter
$dialog.DefaultExt = "asar"
$dialog.AddExtension = $true
$dialog.FileName = $DefaultFileName
if ($InitialDir -and (Test-Path $InitialDir)) {
    $dialog.InitialDirectory = $InitialDir
}

$owner = New-Object Win32WindowWrapperSave
if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    Write-Output $dialog.FileName
}
