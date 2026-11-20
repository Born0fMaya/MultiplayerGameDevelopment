using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

namespace GameWindow;

/// <summary>
/// Puts this process in a kill-on-close Job Object. Every child process inherits the job, so when this
/// process ends for any reason (including a crash or a forced kill) Windows terminates the whole tree.
/// </summary>
static class JobObject
{
    const int JobObjectExtendedLimitInformation = 9;
    const uint JOB_OBJECT_LIMIT_BREAKAWAY_OK = 0x0800;
    const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;
    const uint CREATE_BREAKAWAY_FROM_JOB = 0x01000000;

    // Never closed on purpose: the OS closes it when the process exits, which kills the job.
    static IntPtr _job;

    public static bool Active => _job != IntPtr.Zero;

    public static void AssignSelf()
    {
        var job = CreateJobObjectW(IntPtr.Zero, null);
        if (job == IntPtr.Zero)
        {
            Log.Error($"CreateJobObject failed: {Marshal.GetLastWin32Error()}");
            return;
        }
        var info = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_BREAKAWAY_OK;
        if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, ref info, Marshal.SizeOf<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>()))
        {
            Log.Error($"SetInformationJobObject failed: {Marshal.GetLastWin32Error()}");
            CloseHandle(job);
            return;
        }
        if (!AssignProcessToJobObject(job, GetCurrentProcess()))
        {
            Log.Error($"AssignProcessToJobObject failed: {Marshal.GetLastWin32Error()}");
            CloseHandle(job);
            return;
        }
        _job = job;
        Log.Info("Assigned to kill-on-close job object");
    }

    /// <summary>
    /// Kills every process this one started, including WebView2 and anything a module launched.
    /// Used on shutdown in case the job object could not be assigned (for example when this process
    /// was already inside a job that does not allow nesting).
    /// </summary>
    public static void KillDescendants()
    {
        int self = Environment.ProcessId;
        Process[] all;
        try { all = Process.GetProcesses(); }
        catch { return; }

        foreach (var proc in all)
        {
            try
            {
                if (proc.Id == self || ParentPid(proc) != self) continue;
                try { proc.Kill(entireProcessTree: true); }
                catch (Exception ex) { Log.Warn($"Kill descendant {proc.Id} failed: {ex.Message}"); }
            }
            catch { }
            finally { try { proc.Dispose(); } catch { } }
        }
    }

    static int ParentPid(Process proc)
    {
        var info = new PROCESS_BASIC_INFORMATION();
        int status = NtQueryInformationProcess(proc.Handle, 0, ref info, Marshal.SizeOf<PROCESS_BASIC_INFORMATION>(), out _);
        return status == 0 ? unchecked((int)info.InheritedFromUniqueProcessId.ToInt64()) : -1;
    }

    /// <summary>
    /// Starts a process outside the job, so things like the user's web browser are not killed when this
    /// program closes. Only used for opening URLs and files in their default apps.
    /// </summary>
    public static void StartDetached(string commandLine)
    {
        if (TryCreate(commandLine, CREATE_BREAKAWAY_FROM_JOB)) return;
        if (!TryCreate(commandLine, 0)) throw new Win32Exception(Marshal.GetLastWin32Error());
    }

    static bool TryCreate(string commandLine, uint flags)
    {
        var si = new STARTUPINFO { cb = Marshal.SizeOf<STARTUPINFO>() };
        if (!CreateProcessW(null, new StringBuilder(commandLine), IntPtr.Zero, IntPtr.Zero, false, flags,
                IntPtr.Zero, null, ref si, out var pi))
            return false;
        CloseHandle(pi.hThread);
        CloseHandle(pi.hProcess);
        return true;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct JOBOBJECT_BASIC_LIMIT_INFORMATION
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct IO_COUNTERS
    {
        public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount;
        public ulong ReadTransferCount, WriteTransferCount, OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct STARTUPINFO
    {
        public int cb;
        public string? lpReserved, lpDesktop, lpTitle;
        public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
        public short wShowWindow, cbReserved2;
        public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct PROCESS_INFORMATION
    {
        public IntPtr hProcess, hThread;
        public int dwProcessId, dwThreadId;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct PROCESS_BASIC_INFORMATION
    {
        public IntPtr Reserved1;
        public IntPtr PebBaseAddress;
        public IntPtr Reserved2_0;
        public IntPtr Reserved2_1;
        public IntPtr UniqueProcessId;
        public IntPtr InheritedFromUniqueProcessId;
    }

    [DllImport("ntdll.dll")]
    static extern int NtQueryInformationProcess(IntPtr processHandle, int processInformationClass,
        ref PROCESS_BASIC_INFORMATION processInformation, int processInformationLength, out int returnLength);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern IntPtr CreateJobObjectW(IntPtr attributes, string? name);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref JOBOBJECT_EXTENDED_LIMIT_INFORMATION info, int length);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

    [DllImport("kernel32.dll")]
    static extern IntPtr GetCurrentProcess();

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool CloseHandle(IntPtr handle);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool CreateProcessW(string? application, StringBuilder commandLine, IntPtr processAttributes,
        IntPtr threadAttributes, bool inheritHandles, uint creationFlags, IntPtr environment, string? currentDirectory,
        ref STARTUPINFO startupInfo, out PROCESS_INFORMATION processInformation);
}
