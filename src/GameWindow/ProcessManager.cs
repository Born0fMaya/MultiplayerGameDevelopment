using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text;

namespace GameWindow;

sealed class ManagedProcess
{
    public required int Id { get; init; }
    public required Process Proc { get; init; }
    public required string File { get; init; }
    public required string Args { get; init; }
    public required string Owner { get; init; }
    public bool StreamToPage { get; init; }
    public DateTime Started { get; } = DateTime.Now;
    public bool Exited { get; set; }
    public int? ExitCode { get; set; }
    public DateTime? ExitTime { get; set; }
    public TaskCompletionSource Completion { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);

    readonly object _gate = new();
    readonly List<(long Seq, string Stream, string Text)> _chunks = new();
    long _seq;
    int _chars;

    public void Add(string stream, string text)
    {
        lock (_gate)
        {
            _chunks.Add((++_seq, stream, text));
            _chars += text.Length;
            while (_chars > 1_000_000 && _chunks.Count > 1)
            {
                _chars -= _chunks[0].Text.Length;
                _chunks.RemoveAt(0);
            }
        }
    }

    public object Output(long since, int maxChars)
    {
        lock (_gate)
        {
            var picked = new List<object>();
            int total = 0;
            long next = since;
            foreach (var c in _chunks.Where(c => c.Seq > since))
            {
                if (total + c.Text.Length > maxChars && picked.Count > 0) break;
                picked.Add(new { seq = c.Seq, stream = c.Stream, text = c.Text });
                total += c.Text.Length;
                next = c.Seq;
            }
            return new { id = Id, next, more = next < _seq, exited = Exited, exitCode = ExitCode, chunks = picked };
        }
    }

    public string Text(string stream)
    {
        lock (_gate) return string.Concat(_chunks.Where(c => c.Stream == stream).Select(c => c.Text));
    }

    public object Info()
    {
        int? pid = null;
        try { pid = Proc.Id; } catch { }
        return new { id = Id, pid, file = File, args = Args, owner = Owner, started = Started, exited = Exited, exitCode = ExitCode, exitTime = ExitTime };
    }
}

/// <summary>Starts and tracks child processes. All of them are killed on shutdown (and by the Job Object on any exit).</summary>
sealed class ProcessManager
{
    readonly ConcurrentDictionary<int, ManagedProcess> _procs = new();
    int _nextId;

    public ManagedProcess Start(string file, IReadOnlyList<string>? argList, string? argString, string? cwd,
        IReadOnlyDictionary<string, string?>? env, bool streamToPage, string owner)
    {
        var psi = new ProcessStartInfo
        {
            FileName = file,
            UseShellExecute = false,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
            StandardInputEncoding = new UTF8Encoding(false),
            WorkingDirectory = cwd != null ? Paths.Resolve(cwd) : Paths.Root,
        };
        if (argList != null) foreach (var a in argList) psi.ArgumentList.Add(a);
        else if (argString != null) psi.Arguments = argString;
        if (env != null)
            foreach (var (k, v) in env)
                if (v == null) psi.Environment.Remove(k); else psi.Environment[k] = v;

        var proc = new Process { StartInfo = psi };
        proc.Start();

        var mp = new ManagedProcess
        {
            Id = Interlocked.Increment(ref _nextId),
            Proc = proc,
            File = file,
            Args = argList != null ? string.Join(" ", argList) : argString ?? "",
            Owner = owner,
            StreamToPage = streamToPage,
        };
        _procs[mp.Id] = mp;
        Log.Info($"Started process #{mp.Id} (pid {proc.Id}) {file} {mp.Args} [{owner}]");

        var outTask = Pump(mp, proc.StandardOutput, "stdout");
        var errTask = Pump(mp, proc.StandardError, "stderr");
        _ = Task.Run(async () =>
        {
            try { await proc.WaitForExitAsync(); } catch { }
            try { await Task.WhenAll(outTask, errTask).WaitAsync(TimeSpan.FromSeconds(2)); } catch { }
            mp.Exited = true;
            try { mp.ExitCode = proc.ExitCode; } catch { }
            mp.ExitTime = DateTime.Now;
            mp.Completion.TrySetResult();
            Host.Post(new { type = "event", name = "process.exit", data = new { id = mp.Id, exitCode = mp.ExitCode } });
            Prune();
        });
        return mp;
    }

    static async Task Pump(ManagedProcess mp, StreamReader reader, string stream)
    {
        var buf = new char[4096];
        try
        {
            int n;
            while ((n = await reader.ReadAsync(buf, 0, buf.Length)) > 0)
            {
                var text = new string(buf, 0, n);
                mp.Add(stream, text);
                if (mp.StreamToPage)
                    Host.Post(new { type = "event", name = "process.output", data = new { id = mp.Id, stream, text } });
            }
        }
        catch { }
    }

    public async Task<object> Exec(string file, IReadOnlyList<string>? argList, string? argString, string? cwd,
        string? stdin, int timeoutMs, string owner)
    {
        var mp = Start(file, argList, argString, cwd, null, false, owner);
        if (stdin != null)
        {
            try { await mp.Proc.StandardInput.WriteAsync(stdin); } catch { }
        }
        try { mp.Proc.StandardInput.Close(); } catch { }
        bool timedOut = await Task.WhenAny(mp.Completion.Task, Task.Delay(timeoutMs)) != mp.Completion.Task;
        if (timedOut) Kill(mp.Id);
        return new { exitCode = mp.ExitCode, timedOut, stdout = mp.Text("stdout"), stderr = mp.Text("stderr") };
    }

    public ManagedProcess Get(int id) =>
        _procs.TryGetValue(id, out var mp) ? mp : throw new ArgumentException($"No process with id {id}.");

    public void Write(int id, string text)
    {
        var mp = Get(id);
        if (mp.Exited) throw new InvalidOperationException($"Process {id} has exited.");
        mp.Proc.StandardInput.Write(text);
        mp.Proc.StandardInput.Flush();
    }

    public void CloseInput(int id) => Get(id).Proc.StandardInput.Close();

    public bool Kill(int id)
    {
        var mp = Get(id);
        if (mp.Exited) return false;
        try { mp.Proc.Kill(entireProcessTree: true); return true; }
        catch (Exception ex) { Log.Warn($"Kill #{id} failed: {ex.Message}"); return false; }
    }

    public object[] List() => _procs.Values.OrderBy(p => p.Id).Select(p => p.Info()).ToArray();

    public int RunningCount => _procs.Values.Count(p => !p.Exited);

    public void KillAll()
    {
        foreach (var mp in _procs.Values.Where(p => !p.Exited))
        {
            try { mp.Proc.Kill(entireProcessTree: true); }
            catch (Exception ex) { Log.Warn($"Kill #{mp.Id} on shutdown failed: {ex.Message}"); }
        }
    }

    void Prune()
    {
        var exited = _procs.Values.Where(p => p.Exited).OrderBy(p => p.Id).ToList();
        foreach (var p in exited.Take(Math.Max(0, exited.Count - 50)))
            if (_procs.TryRemove(p.Id, out var removed)) removed.Proc.Dispose();
    }
}
