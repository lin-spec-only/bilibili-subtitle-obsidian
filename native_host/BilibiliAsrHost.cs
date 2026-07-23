using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;

public static class BilibiliAsrHost
{
    private const string Python = @"D:\Tech_learn_envs\bilibili-asr\Scripts\python.exe";
    private const string Repo = @"D:\Projects\bilibili-subtitle-edge";
    private const string Data = @"D:\BilibiliASR";
    private const string PidFile = @"D:\BilibiliASR\asr-service.pid";

    public static void Main()
    {
        string request = ReadMessage();
        string action = Regex.IsMatch(request ?? "", "\\\"action\\\"\\s*:\\s*\\\"start\\\"", RegexOptions.IgnoreCase) ? "start" : "stop";
        try
        {
            if (action == "start") Start(); else Stop();
            WriteMessage("{\"ok\":true,\"message\":\"" + (action == "start" ? "Local ASR service started" : "Local ASR service stopped") + "\"}");
        }
        catch (Exception error)
        {
            WriteMessage("{\"ok\":false,\"error\":\"" + Escape(error.Message) + "\"}");
        }
    }

    private static void Start()
    {
        if (IsHealthy()) return;
        if (!File.Exists(Python)) throw new InvalidOperationException("Local ASR environment is missing. Run setup-asr.ps1 first.");
        Directory.CreateDirectory(Data);
        ProcessStartInfo info = new ProcessStartInfo(Python, "-m uvicorn asr_service.app.main:app --host 127.0.0.1 --port 8766");
        info.WorkingDirectory = Repo;
        info.UseShellExecute = false;
        info.CreateNoWindow = true;
        // Do not let Uvicorn logs corrupt the native-messaging response stream.
        info.RedirectStandardOutput = true;
        info.RedirectStandardError = true;
        info.EnvironmentVariables["HF_HOME"] = @"D:\AI_Models\huggingface";
        info.EnvironmentVariables["BILIBILI_ASR_MODEL_DIR"] = @"D:\AI_Models\faster-whisper";
        info.EnvironmentVariables["BILIBILI_ASR_DATA_DIR"] = Data;
        info.EnvironmentVariables["BILIBILI_ASR_MODEL"] = "small";
        info.EnvironmentVariables["BILIBILI_ASR_DEVICE"] = "cpu";
        info.EnvironmentVariables["BILIBILI_ASR_COMPUTE_TYPE"] = "int8";
        Process process = Process.Start(info);
        process.OutputDataReceived += delegate(object sender, DataReceivedEventArgs args) { };
        process.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs args) { };
        process.BeginOutputReadLine();
        process.BeginErrorReadLine();
        File.WriteAllText(PidFile, process.Id.ToString());
        for (int i = 0; i < 40; i++)
        {
            System.Threading.Thread.Sleep(250);
            if (IsHealthy()) return;
            if (process.HasExited) throw new InvalidOperationException("Local ASR service failed to start.");
        }
        throw new InvalidOperationException("Local ASR service startup timed out.");
    }

    private static void Stop()
    {
        if (!File.Exists(PidFile)) return;
        int pid;
        if (!Int32.TryParse(File.ReadAllText(PidFile).Trim(), out pid)) { File.Delete(PidFile); return; }
        try
        {
            Process process = Process.GetProcessById(pid);
            if (!process.HasExited) process.Kill();
        }
        catch (ArgumentException) { }
        finally { if (File.Exists(PidFile)) File.Delete(PidFile); }
    }

    private static bool IsHealthy()
    {
        try
        {
            HttpWebRequest request = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:8766/health");
            request.Timeout = 1000;
            using (HttpWebResponse response = (HttpWebResponse)request.GetResponse()) return response.StatusCode == HttpStatusCode.OK;
        }
        catch { return false; }
    }

    private static string ReadMessage()
    {
        Stream input = Console.OpenStandardInput();
        byte[] length = new byte[4];
        if (input.Read(length, 0, 4) != 4) return "";
        int size = BitConverter.ToInt32(length, 0);
        byte[] body = new byte[size];
        int offset = 0;
        while (offset < size) { int count = input.Read(body, offset, size - offset); if (count <= 0) break; offset += count; }
        return Encoding.UTF8.GetString(body, 0, offset);
    }

    private static void WriteMessage(string message)
    {
        byte[] body = Encoding.UTF8.GetBytes(message);
        byte[] length = BitConverter.GetBytes(body.Length);
        Stream output = Console.OpenStandardOutput();
        output.Write(length, 0, length.Length);
        output.Write(body, 0, body.Length);
        output.Flush();
    }

    private static string Escape(string value) { return (value ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", " ").Replace("\n", " "); }
}
