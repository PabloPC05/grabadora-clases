using System.IO;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace GrabadoraClases;

public class AppSettings
{
    public string ApiKey { get; set; } = string.Empty;
    public string WhisperModel { get; set; } = "tiny";
    public string RecordingLanguage { get; set; } = "es"; // idioma fijo para grabación en tiempo real
    public string OutputDir { get; set; } = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "grabaciones");
    public string InitialPrompt { get; set; } = "Clase universitaria, terminología académica y técnica.";
    public float GainDb { get; set; } = 12.0f;
    public bool AutoTranslate { get; set; } = true;

    private static readonly string SettingsPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "GrabadoraClases", "settings.json");

    public static AppSettings Load()
    {
        try
        {
            if (File.Exists(SettingsPath))
            {
                var json = File.ReadAllText(SettingsPath);
                return JsonSerializer.Deserialize<AppSettings>(json) ?? new AppSettings();
            }
        }
        catch { }

        var settings = new AppSettings();
        settings.ApiKey = Environment.GetEnvironmentVariable("ANTHROPIC_API_KEY") ?? string.Empty;
        return settings;
    }

    public void Save()
    {
        Directory.CreateDirectory(Path.GetDirectoryName(SettingsPath)!);
        var json = JsonSerializer.Serialize(this, new JsonSerializerOptions { WriteIndented = true });
        File.WriteAllText(SettingsPath, json);
    }
}
