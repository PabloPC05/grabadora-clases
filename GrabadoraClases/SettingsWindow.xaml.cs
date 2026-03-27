using System.Windows;
using System.Windows.Controls;

namespace GrabadoraClases;

public partial class SettingsWindow : Window
{
    public AppSettings Settings { get; private set; }
    private string _apiKeyValue = "";

    public SettingsWindow(AppSettings current)
    {
        InitializeComponent();
        Settings = current;
        LoadValues();
    }

    private void LoadValues()
    {
        _apiKeyValue = Settings.ApiKey;
        ApiKeyBox.Password = Settings.ApiKey;
        OutputDirBox.Text = Settings.OutputDir;
        PromptBox.Text = Settings.InitialPrompt;
        GainSlider.Value = Settings.GainDb;
        AutoTranslateCheck.IsChecked = Settings.AutoTranslate;

        // Select model combo
        foreach (ComboBoxItem item in ModelCombo.Items)
        {
            if (item.Tag?.ToString() == Settings.WhisperModel)
            {
                ModelCombo.SelectedItem = item;
                break;
            }
        }
        if (ModelCombo.SelectedIndex < 0) ModelCombo.SelectedIndex = 0; // tiny default

        // Select language combo
        foreach (ComboBoxItem item in LangCombo.Items)
        {
            if (item.Tag?.ToString() == Settings.RecordingLanguage)
            {
                LangCombo.SelectedItem = item;
                break;
            }
        }
        if (LangCombo.SelectedIndex < 0) LangCombo.SelectedIndex = 0; // español default

        ModelsPathLabel.Text = $"Modelos guardados en: {MainWindow.ModelsDir}";
    }

    private void ApiKeyBox_PasswordChanged(object sender, RoutedEventArgs e)
    {
        _apiKeyValue = ApiKeyBox.Password;
    }

    private void ToggleApiKeyVisibility_Click(object sender, RoutedEventArgs e)
    {
        // For simplicity, just show the key in a message box
        MessageBox.Show(string.IsNullOrEmpty(_apiKeyValue) ? "(vacía)" : _apiKeyValue,
            "API Key", MessageBoxButton.OK, MessageBoxImage.Information);
    }

    private void BrowseOutputDir_Click(object sender, RoutedEventArgs e)
    {
        var dlg = new Microsoft.Win32.OpenFolderDialog
        {
            Title = "Selecciona la carpeta de salida",
            InitialDirectory = OutputDirBox.Text
        };
        if (dlg.ShowDialog() == true)
            OutputDirBox.Text = dlg.FolderName;
    }

    private void GainSlider_ValueChanged(object sender, RoutedPropertyChangedEventArgs<double> e)
    {
        if (GainLabel != null)
            GainLabel.Text = $"{(int)GainSlider.Value} dB";
    }

    private void SaveButton_Click(object sender, RoutedEventArgs e)
    {
        var selectedModel = (ModelCombo.SelectedItem as ComboBoxItem)?.Tag?.ToString() ?? "tiny";
        var selectedLang = (LangCombo.SelectedItem as ComboBoxItem)?.Tag?.ToString() ?? "es";

        Settings = new AppSettings
        {
            ApiKey = _apiKeyValue,
            WhisperModel = selectedModel,
            RecordingLanguage = selectedLang,
            OutputDir = OutputDirBox.Text.Trim(),
            InitialPrompt = PromptBox.Text.Trim(),
            GainDb = (float)GainSlider.Value,
            AutoTranslate = AutoTranslateCheck.IsChecked ?? true
        };

        DialogResult = true;
    }

    private void CancelButton_Click(object sender, RoutedEventArgs e)
    {
        DialogResult = false;
    }
}
