param(
    [string]$Title = "Chọn thư mục"
)

$source = @"
using System;
using System.Runtime.InteropServices;

namespace NativeFolderDialog {
    [ComImport]
    [Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7")]
    [ClassInterface(ClassInterfaceType.None)]
    public class FileOpenDialogRCW { }

    [ComImport]
    [Guid("d57c7288-d4ad-4768-be02-9d969532d960")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IFileOpenDialog {
        [PreserveSig] int Show(IntPtr parent);
        void SetFileTypes();
        void SetFileTypeIndex();
        void GetFileTypeIndex();
        void Advise();
        void Unadvise();
        void SetOptions(uint fos);
        void GetOptions(out uint fos);
        void SetDefaultFolder(IntPtr psi);
        void SetFolder(IntPtr psi);
        void GetFolder(out IntPtr ppsi);
        void GetCurrentSelection(out IntPtr ppsi);
        void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string pszName);
        void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string pszName);
        void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string pszTitle);
        void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string pszText);
        void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string pszLabel);
        void GetResult(out IShellItem ppsi);
        void AddPlace();
        void SetDefaultExtension();
        void Close();
        void SetClientGuid();
        void ClearClientData();
        void SetFilter();
        void GetResults(out IntPtr ppenum);
        void GetSelectedItems(out IntPtr ppsai);
    }

    [ComImport]
    [Guid("43826d1e-e718-42ee-bc55-a1e261c37bfe")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IShellItem {
        void BindToHandler();
        void GetParent();
        void GetDisplayName(uint sigdnName, [MarshalAs(UnmanagedType.LPWStr)] out string ppszName);
        void GetAttributes();
        void Compare();
    }

    public class FolderPicker {
        [DllImport("user32.dll")]
        public static extern IntPtr GetForegroundWindow();

        public static string ShowDialog(string title) {
            try {
                var dialog = (IFileOpenDialog)new FileOpenDialogRCW();
                if (!string.IsNullOrEmpty(title)) {
                    dialog.SetTitle(title);
                }
                uint options;
                dialog.GetOptions(out options);
                // 0x20 = FOS_PICKFOLDERS, 0x40 = FOS_FORCEFILESYSTEM
                dialog.SetOptions(options | 0x00000020 | 0x00000040);
                
                IntPtr owner = GetForegroundWindow();
                int hr = dialog.Show(owner);
                if (hr == 0) { // S_OK
                    IShellItem item;
                    dialog.GetResult(out item);
                    string path;
                    item.GetDisplayName(0x80058000, out path); // SIGDN_FILESYSPATH
                    return path;
                }
            } catch {
                // User cancelled or dialog error
            }
            return null;
        }
    }
}
"@

Add-Type -TypeDefinition $source -Language CSharp

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$res = [NativeFolderDialog.FolderPicker]::ShowDialog($Title)
if ($res) {
    Write-Output $res
}
