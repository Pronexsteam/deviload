# Deviload — WPF front-end for yt-dlp (Windows PowerShell 5.1, single file)
# Launched via "Deviload.bat" (or compiled to Deviload.exe by build.ps1)

Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# Real acrylic window blur (Windows 10 1803+/11) + hidden process launcher that avoids cmd.exe argument mangling
if (-not ('Win32.Acrylic' -as [type])) {
  Add-Type @'
using System;
using System.IO;
using System.Diagnostics;
using System.Text;
using System.Runtime.InteropServices;
namespace Win32 {
  public class Acrylic {
    [StructLayout(LayoutKind.Sequential)]
    public struct AccentPolicy { public int AccentState; public int AccentFlags; public int GradientColor; public int AnimationId; }
    [StructLayout(LayoutKind.Sequential)]
    public struct WinCompAttrData { public int Attribute; public IntPtr Data; public int SizeOfData; }
    [DllImport("user32.dll")]
    public static extern int SetWindowCompositionAttribute(IntPtr hwnd, ref WinCompAttrData data);
    [DllImport("dwmapi.dll")]
    public static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int val, int size);
    public static void Apply(IntPtr hwnd, int tint) {
      AccentPolicy accent = new AccentPolicy();
      accent.AccentState = 3;
      accent.GradientColor = tint;
      int sz = Marshal.SizeOf(accent);
      IntPtr ptr = Marshal.AllocHGlobal(sz);
      Marshal.StructureToPtr(accent, ptr, false);
      WinCompAttrData data = new WinCompAttrData();
      data.Attribute = 19;
      data.Data = ptr;
      data.SizeOfData = sz;
      SetWindowCompositionAttribute(hwnd, ref data);
      Marshal.FreeHGlobal(ptr);
      int round = 2;
      try { DwmSetWindowAttribute(hwnd, 33, ref round, 4); } catch {}
    }
  }

  public class AppId {
    // Own taskbar identity: without it the window is grouped under powershell.exe (pinned PowerShell icon instead of ours)
    [DllImport("shell32.dll")]
    public static extern int SetCurrentProcessExplicitAppUserModelID([MarshalAs(UnmanagedType.LPWStr)] string id);
  }

  public class ProcessRunner {
    public static Process StartHidden(string exe, string arguments, string outFile, string errFile, string workDir) {
      try { if (File.Exists(outFile)) File.Delete(outFile); } catch {}
      try { if (File.Exists(errFile)) File.Delete(errFile); } catch {}

      ProcessStartInfo psi = new ProcessStartInfo();
      if (exe.EndsWith(".bat", StringComparison.OrdinalIgnoreCase) || exe.EndsWith(".cmd", StringComparison.OrdinalIgnoreCase)) {
        psi.FileName = Environment.GetEnvironmentVariable("ComSpec") ?? "cmd.exe";
        psi.Arguments = "/c \"" + exe + "\" " + arguments;
      } else {
        psi.FileName = exe;
        psi.Arguments = arguments;
      }
      psi.UseShellExecute = false;
      psi.CreateNoWindow = true;
      psi.WindowStyle = ProcessWindowStyle.Hidden;
      psi.RedirectStandardOutput = true;
      psi.RedirectStandardError = true;
      psi.StandardOutputEncoding = new UTF8Encoding(false);
      psi.StandardErrorEncoding = new UTF8Encoding(false);
      if (!string.IsNullOrEmpty(workDir)) {
        psi.WorkingDirectory = workDir;
      }
      psi.EnvironmentVariables["PYTHONIOENCODING"] = "utf-8";
      psi.EnvironmentVariables["PYTHONUTF8"] = "1";
      psi.EnvironmentVariables["LC_ALL"] = "C.UTF-8";

      Process p = new Process();
      p.StartInfo = psi;

      FileStream outFs = new FileStream(outFile, FileMode.Create, FileAccess.Write, FileShare.ReadWrite);
      StreamWriter outSw = new StreamWriter(outFs, new UTF8Encoding(false));
      FileStream errFs = new FileStream(errFile, FileMode.Create, FileAccess.Write, FileShare.ReadWrite);
      StreamWriter errSw = new StreamWriter(errFs, new UTF8Encoding(false));

      object lockOut = new object();
      object lockErr = new object();

      p.OutputDataReceived += (s, e) => {
        if (e.Data != null) {
          lock (lockOut) {
            try {
              outSw.WriteLine(e.Data);
              outSw.Flush();
            } catch {}
          }
        }
      };
      p.ErrorDataReceived += (s, e) => {
        if (e.Data != null) {
          lock (lockErr) {
            try {
              errSw.WriteLine(e.Data);
              errSw.Flush();
            } catch {}
          }
        }
      };
      p.Exited += (s, e) => {
        try { lock (lockOut) { outSw.Flush(); outSw.Close(); } } catch {}
        try { lock (lockErr) { errSw.Flush(); errSw.Close(); } } catch {}
      };
      p.EnableRaisingEvents = true;

      p.Start();
      p.BeginOutputReadLine();
      p.BeginErrorReadLine();

      return p;
    }
  }
}
'@
}
# must run before the window exists so the taskbar shows the app icon (not the PowerShell host icon)
try { [Win32.AppId]::SetCurrentProcessExplicitAppUserModelID('Deviload.App') | Out-Null } catch {}

$env:PYTHONUTF8 = '1'
$env:PYTHONIOENCODING = 'utf-8'
$env:PATH = "$PSScriptRoot;$env:PATH"

$root = $PSScriptRoot
if (-not $root) { try { $root = Split-Path -Parent ([System.Diagnostics.Process]::GetCurrentProcess().MainModule.FileName) } catch {} }
if (-not $root) { $root = (Get-Location).Path }
$env:PATH = "$root;$env:PATH"

# ---------------- UI strings (RU / EN) ----------------
# Every user-visible string lives here. T 'key' resolves in the current language,
# falls back to English, then to the key itself. Apply-Language re-applies all texts at runtime.
$script:L = @{
  ru = @{
    # window / title bar
    tip_ytsearch = 'Поиск на YouTube'; tip_history = 'История скачиваний'; tip_search = 'Поиск YouTube'; tip_settings = 'Настройки'
    tip_min = 'Свернуть'; tip_close = 'Закрыть'; ttl_error = 'Ошибка'
    err_no_ytdlp = "Не найден yt-dlp.exe рядом со скриптом:`n{0}"
    # main form
    lbl_links = 'Ссылки — по одной в строке (можно несколько)'
    hint_url = 'Вставь ссылку на видео…  можно несколько, по одной в строке'
    btn_paste = 'Вставить'; btn_clear = 'Очистить'
    btn_torrent = 'Смотреть торрент  ·  magnet или .torrent (через qBittorrent → VLC)'
    lbl_quality = 'Качество'; lbl_audio = 'Аудиодорожка / Дубляж (в ролике несколько озвучек)'
    lbl_trim = 'Обрезка — перетащи маркеры (появится после превью)'
    trim_all = 'весь ролик'; trim_all_after = 'весь ролик (появится после превью)'
    trim_start = 'начало'; trim_end = 'конец'; trim_range = 'с {0} по {1}'
    trim_chapters = 'скачаются выбранные главы ({0}) отдельными файлами'
    btn_chapters = 'Главы'; btn_chapters_n = 'Главы ({0})'; btn_chapters_sel = 'Главы: выбрано {0}'
    btn_gif = 'GIF из выделенного'
    tg_playlist = 'Плейлист'; hint_range = 'Диапазон: 1-10, 15'
    tg_split = 'Нарезать по главам'; tip_split = 'Автоматически разрезать видео/альбом по главам/таймкодам'
    lbl_folder = 'Папка сохранения'
    preset_dl = 'Загрузки'; preset_music = 'Музыка'; preset_desktop = 'Рабочий стол'
    tip_preset_dl = 'Папка Загрузки'; tip_preset_music = 'Папка Музыка'; tip_preset_desktop = 'Рабочий стол'
    btn_browse = 'Обзор'; btn_download = 'Скачать'; btn_cancel = 'Отмена'; btn_log = 'Лог'; btn_folder = 'Папка'; btn_update = 'Обновить'
    st_ready = 'Готов к работе'; btn_clear_queue = 'Очистить очередь'; btn_open_file = 'Открыть файл'
    # preview card
    tip_watch = 'Смотреть видео'; tip_thumb = 'Скачать HD-обложку'
    pv_loading = 'Загрузка превью…'; pv_untitled = 'Без названия'; pv_failed = 'Не удалось получить превью'
    audio_original = 'Оригинал'; audio_ru = '🇷🇺 Русский дубляж'; audio_all = '🌐 Все дорожки (Multi-Audio)'
    # search overlay
    ttl_search = 'Поиск на YouTube'; btn_find = 'Найти'; btn_close = 'Закрыть'
    st_searching = 'Поиск…'; err_search_start = 'Не удалось запустить поиск'; none_found = 'Ничего не найдено'
    # settings overlay
    ttl_settings = 'Настройки'; btn_done = 'Готово'
    set_parallel = 'Параллельные загрузки'; set_rate = 'Лимит скорости'; set_codec = 'Видеокодек'
    set_archive = 'Пропускать уже скачанное (архив загрузок)'; set_clip = 'Автодобавление ссылок из буфера обмена'
    set_cookies = 'Cookies из браузера'; set_sb = 'SponsorBlock (YouTube)'; set_sb_tg = 'Вырезать рекламу и спонсорские интеграции'
    set_tagger = 'Smart Music Tagger (MP3 / FLAC)'; set_tagger_tg = 'Авто-очистка названий треков от мусора и запись тегов'
    set_subs = 'Субтитры'; set_subs_tg = 'Скачивать и вшивать субтитры'
    set_theme = 'Тема'; set_opacity = 'Прозрачность окна'
    lang_ru = 'Русский интерфейс'; lang_en = 'English interface'
    # option pills
    q_max = 'Максимальное (4K/2K/1080p)'; q_1080 = '1080p (Full HD)'; q_720 = '720p (HD)'; q_480 = '480p'
    q_mp3 = 'MP3 320 kbps (Аудио)'; q_flac = 'WAV / FLAC (Без сжатия)'
    c_none = 'Нет'; c_file = 'Файл cookies.txt'
    s_ru = 'Рус'; s_en = 'Англ'; s_both = 'Рус+Англ'
    t_dark = 'Тёмная'; t_light = 'Светлая'
    rate_none = 'Без лимита'; rate_fmt = '{0} МБ/с'
    codec_auto = 'Авто'; codec_h264 = 'H.264 (совместимость)'; codec_av1 = 'AV1/VP9 (меньше вес)'
    # history overlay
    ttl_history = 'История скачиваний'; btn_clear_all = 'Очистить всё'; hint_hist_search = 'Поиск по истории…'
    hist_empty = 'История пока пуста'; btn_again = 'Скачать снова'; btn_open = 'Открыть'
    # chapters overlay
    ttl_chapters = 'Главы ролика'; btn_all = 'Все'; btn_none = 'Сброс'; btn_apply = 'Применить'
    hint_chapters = 'Отметь главы — скачаются отдельными файлами'
    # units
    unit_gb = 'ГБ'; unit_mb = 'МБ'; unit_kb = 'КБ'
    # download states
    fb_video = 'Видео'
    st_downloading = 'Скачивание'; st_convert_mp3 = 'Конвертация в MP3'; st_merging = 'Объединение видео и звука'
    err_ytdlp_start = 'Не удалось запустить yt-dlp'
    q_done = 'Готово'; q_error = 'Ошибка'; q_wait = 'Ожидание'; q_processing = 'Обработка'; q_cancelled = 'Отменено'
    st_parallel = 'Параллельно: {0}'; st_queued = ' · в очереди: {0}'; st_dl_progress = 'Скачивание · готово {0} из {1}'
    st_cancelled = 'Отменено'; st_done = '✓ Готово'
    det_file_saved = 'Файл сохранён в выбранную папку'; det_files_saved = 'Файлы сохранены в выбранную папку'
    ntf_convert_done = 'Конвертация завершена'
    st_convert_err = 'Ошибка конвертации (код {0}) — смотри лог'; st_err_code = 'Ошибка (код {0}) — смотри лог'
    st_dl_all = 'Скачано: {0} из {1}'; st_dl_partial = 'Готово: {0} из {1}, ошибок {2}'; ntf_done_n = 'Готово: {0} из {1}'
    st_dl_cookies_stale = 'Скачано — cookies устарели, обнови файл'; st_downloaded = 'Скачано!'
    st_cookie_browser_fail = 'Браузер не отдал cookies — нужен файл cookies.txt'
    det_cookie_browser_fail = 'Chrome/Edge шифруют cookies. Экспортируй расширением «Get cookies.txt LOCALLY» и выбери «Файл cookies.txt»'
    st_dl_failed = 'Не удалось скачать'; det_see_log = 'Подробности — кнопка «Лог»'
    st_busy = 'Занят — дождись окончания текущей задачи'; st_preparing = 'Подготовка…'
    st_paste_link = 'Вставь ссылку!'; err_no_cookies = 'Нет файла cookies.txt рядом с yt-dlp.exe'; err_folder = 'Папка недоступна'
    st_log_empty = 'Лог пока пуст'; st_updating = 'Обновление yt-dlp...'
    # GIF
    st_gif_done = 'GIF готов!'; det_gif_saved = 'GIF сохранён в выбранную папку'
    st_gif_failed = 'Не удалось сделать GIF'; det_gif_log = 'Подробности — в открытом логе'
    st_gif_making = 'Создаю GIF...'; err_gif_start = 'Не удалось запустить GIF'
    st_gif_need_url = 'Вставь ссылку для GIF'; st_not_url = 'Это не похоже на ссылку'
    # local convert
    err_no_ffmpeg = 'ffmpeg.exe не найден'; st_convert_title = 'Конвертация: {0}'
    det_convert_local = 'Обработка локального файла через FFmpeg…'; st_converting = 'Конвертация файла…'
    err_convert_start = 'Ошибка запуска конвертера'
    # thumbnail
    st_need_url = 'Вставь ссылку на ролик'; st_thumb_dl = 'Скачивание HD-обложки…'
    # torrent
    dlg_torrent_filter = 'Торрент (*.torrent)|*.torrent|Все файлы (*.*)|*.*'
    st_magnet_hint = 'Вставь magnet-ссылку в поле или выбери .torrent'; st_magnet_hint2 = 'Вставь magnet-ссылку в поле'
    err_need_wv2 = 'Нужен WebView2 (setup-webview2.bat) или VLC'; ttl_torrent = 'Торрент'
    btn_vlc = 'Открыть в VLC'; btn_vlc_none = 'VLC не найден'; hint_vlc = 'Чёрный экран (mkv/x265)? Жми «Открыть в VLC».'
    err_player = 'Не удалось открыть плеер'
    st_tor_install = 'Ставлю движок торрентов (один раз, ~минута)…'; err_no_node = 'Node.js не найден — поставь с nodejs.org'
    st_tor_installed = 'Движок установлен — подключаюсь…'; err_tor_install = 'Не удалось поставить движок (нужен Node.js + интернет)'
    err_no_qb = 'qBittorrent не найден — поставь его'; err_no_vlc = 'VLC не найден — поставь VLC'
    st_not_torrent = 'Это не magnet и не .torrent'; st_qb_adding = 'Добавляю в qBittorrent (последовательно)…'
    err_qb_start = 'Не удалось запустить qBittorrent'; st_tor_buffering = 'Качаю начало… VLC откроется через пару секунд'
    st_tor_playing = 'Открываю VLC — смотри (качается на лету)'; err_tor_nodata = 'Долго нет данных — нет пиров или торрент приватный'
    # video window
    ttl_video = 'Видео'; err_wv2 = 'WebView2 не запустился'
    st_need_wv2 = 'Для просмотра до скачивания запусти setup-webview2.bat'; st_need_link = 'Сначала вставь ссылку на видео'
    vid_failed = 'Видео — не удалось воспроизвести (скачай файл)'; tip_fullscreen = 'Во весь экран'; err_video = 'Не удалось открыть видео'
    # tray
    tray_open = 'Открыть'; tray_exit = 'Выход'
  }
  en = @{
    # window / title bar
    tip_ytsearch = 'Search YouTube'; tip_history = 'Download history'; tip_search = 'YouTube search'; tip_settings = 'Settings'
    tip_min = 'Minimize'; tip_close = 'Close'; ttl_error = 'Error'
    err_no_ytdlp = "yt-dlp.exe not found next to the script:`n{0}"
    # main form
    lbl_links = 'Links — one per line (several allowed)'
    hint_url = 'Paste a video link…  several allowed, one per line'
    btn_paste = 'Paste'; btn_clear = 'Clear'
    btn_torrent = 'Watch torrent  ·  magnet or .torrent (via qBittorrent → VLC)'
    lbl_quality = 'Quality'; lbl_audio = 'Audio track / dub (this video has several)'
    lbl_trim = 'Trim — drag the handles (available after preview)'
    trim_all = 'whole video'; trim_all_after = 'whole video (available after preview)'
    trim_start = 'start'; trim_end = 'end'; trim_range = 'from {0} to {1}'
    trim_chapters = 'selected chapters ({0}) will be saved as separate files'
    btn_chapters = 'Chapters'; btn_chapters_n = 'Chapters ({0})'; btn_chapters_sel = 'Chapters: {0} selected'
    btn_gif = 'GIF from selection'
    tg_playlist = 'Playlist'; hint_range = 'Range: 1-10, 15'
    tg_split = 'Split by chapters'; tip_split = 'Automatically split the video/album by chapters/timestamps'
    lbl_folder = 'Save folder'
    preset_dl = 'Downloads'; preset_music = 'Music'; preset_desktop = 'Desktop'
    tip_preset_dl = 'Downloads folder'; tip_preset_music = 'Music folder'; tip_preset_desktop = 'Desktop'
    btn_browse = 'Browse'; btn_download = 'Download'; btn_cancel = 'Cancel'; btn_log = 'Log'; btn_folder = 'Folder'; btn_update = 'Update'
    st_ready = 'Ready'; btn_clear_queue = 'Clear queue'; btn_open_file = 'Open file'
    # preview card
    tip_watch = 'Watch video'; tip_thumb = 'Download HD thumbnail'
    pv_loading = 'Loading preview…'; pv_untitled = 'Untitled'; pv_failed = 'Could not fetch preview'
    audio_original = 'Original'; audio_ru = '🇷🇺 Russian dub'; audio_all = '🌐 All tracks (multi-audio)'
    # search overlay
    ttl_search = 'Search YouTube'; btn_find = 'Search'; btn_close = 'Close'
    st_searching = 'Searching…'; err_search_start = 'Could not start search'; none_found = 'Nothing found'
    # settings overlay
    ttl_settings = 'Settings'; btn_done = 'Done'
    set_parallel = 'Parallel downloads'; set_rate = 'Speed limit'; set_codec = 'Video codec'
    set_archive = 'Skip already downloaded (download archive)'; set_clip = 'Auto-add links from clipboard'
    set_cookies = 'Cookies from browser'; set_sb = 'SponsorBlock (YouTube)'; set_sb_tg = 'Cut ads and sponsor segments'
    set_tagger = 'Smart Music Tagger (MP3 / FLAC)'; set_tagger_tg = 'Auto-clean track titles and write tags'
    set_subs = 'Subtitles'; set_subs_tg = 'Download and embed subtitles'
    set_theme = 'Theme'; set_opacity = 'Window transparency'
    lang_ru = 'Russian interface'; lang_en = 'English interface'
    # option pills
    q_max = 'Best (4K/2K/1080p)'; q_1080 = '1080p (Full HD)'; q_720 = '720p (HD)'; q_480 = '480p'
    q_mp3 = 'MP3 320 kbps (Audio)'; q_flac = 'WAV / FLAC (Lossless)'
    c_none = 'None'; c_file = 'cookies.txt file'
    s_ru = 'Russian'; s_en = 'English'; s_both = 'Russian + English'
    t_dark = 'Dark'; t_light = 'Light'
    rate_none = 'No limit'; rate_fmt = '{0} MB/s'
    codec_auto = 'Auto'; codec_h264 = 'H.264 (compatibility)'; codec_av1 = 'AV1/VP9 (smaller files)'
    # history overlay
    ttl_history = 'Download history'; btn_clear_all = 'Clear all'; hint_hist_search = 'Search history…'
    hist_empty = 'History is empty'; btn_again = 'Download again'; btn_open = 'Open'
    # chapters overlay
    ttl_chapters = 'Video chapters'; btn_all = 'All'; btn_none = 'Reset'; btn_apply = 'Apply'
    hint_chapters = 'Tick chapters — they will be saved as separate files'
    # units
    unit_gb = 'GB'; unit_mb = 'MB'; unit_kb = 'KB'
    # download states
    fb_video = 'Video'
    st_downloading = 'Downloading'; st_convert_mp3 = 'Converting to MP3'; st_merging = 'Merging video and audio'
    err_ytdlp_start = 'Could not start yt-dlp'
    q_done = 'Done'; q_error = 'Error'; q_wait = 'Waiting'; q_processing = 'Processing'; q_cancelled = 'Cancelled'
    st_parallel = 'Parallel: {0}'; st_queued = ' · queued: {0}'; st_dl_progress = 'Downloading · {0} of {1} done'
    st_cancelled = 'Cancelled'; st_done = '✓ Done'
    det_file_saved = 'File saved to the selected folder'; det_files_saved = 'Files saved to the selected folder'
    ntf_convert_done = 'Conversion finished'
    st_convert_err = 'Conversion error (code {0}) — see log'; st_err_code = 'Error (code {0}) — see log'
    st_dl_all = 'Downloaded: {0} of {1}'; st_dl_partial = 'Done: {0} of {1}, {2} failed'; ntf_done_n = 'Done: {0} of {1}'
    st_dl_cookies_stale = 'Downloaded — cookies are stale, refresh the file'; st_downloaded = 'Downloaded!'
    st_cookie_browser_fail = 'Browser did not provide cookies — a cookies.txt file is needed'
    det_cookie_browser_fail = 'Chrome/Edge encrypt cookies. Export them with the "Get cookies.txt LOCALLY" extension and pick "cookies.txt file"'
    st_dl_failed = 'Download failed'; det_see_log = 'Details — the "Log" button'
    st_busy = 'Busy — wait for the current task to finish'; st_preparing = 'Preparing…'
    st_paste_link = 'Paste a link!'; err_no_cookies = 'No cookies.txt next to yt-dlp.exe'; err_folder = 'Folder is not accessible'
    st_log_empty = 'Log is empty'; st_updating = 'Updating yt-dlp...'
    # GIF
    st_gif_done = 'GIF ready!'; det_gif_saved = 'GIF saved to the selected folder'
    st_gif_failed = 'Could not create GIF'; det_gif_log = 'Details — in the opened log'
    st_gif_making = 'Creating GIF...'; err_gif_start = 'Could not start GIF'
    st_gif_need_url = 'Paste a link for the GIF'; st_not_url = 'That does not look like a link'
    # local convert
    err_no_ffmpeg = 'ffmpeg.exe not found'; st_convert_title = 'Converting: {0}'
    det_convert_local = 'Processing local file with FFmpeg…'; st_converting = 'Converting file…'
    err_convert_start = 'Could not start converter'
    # thumbnail
    st_need_url = 'Paste a video link'; st_thumb_dl = 'Downloading HD thumbnail…'
    # torrent
    dlg_torrent_filter = 'Torrent (*.torrent)|*.torrent|All files (*.*)|*.*'
    st_magnet_hint = 'Paste a magnet link or pick a .torrent'; st_magnet_hint2 = 'Paste a magnet link'
    err_need_wv2 = 'WebView2 (setup-webview2.bat) or VLC is required'; ttl_torrent = 'Torrent'
    btn_vlc = 'Open in VLC'; btn_vlc_none = 'VLC not found'; hint_vlc = 'Black screen (mkv/x265)? Click "Open in VLC".'
    err_player = 'Could not open player'
    st_tor_install = 'Installing torrent engine (once, ~1 minute)…'; err_no_node = 'Node.js not found — install it from nodejs.org'
    st_tor_installed = 'Engine installed — connecting…'; err_tor_install = 'Could not install the engine (Node.js + internet required)'
    err_no_qb = 'qBittorrent not found — install it'; err_no_vlc = 'VLC not found — install VLC'
    st_not_torrent = 'Not a magnet link or a .torrent'; st_qb_adding = 'Adding to qBittorrent (sequential)…'
    err_qb_start = 'Could not start qBittorrent'; st_tor_buffering = 'Downloading the start… VLC opens in a few seconds'
    st_tor_playing = 'Opening VLC — streaming while downloading'; err_tor_nodata = 'No data for a long time — no peers or private torrent'
    # video window
    ttl_video = 'Video'; err_wv2 = 'WebView2 failed to start'
    st_need_wv2 = 'To watch before downloading, run setup-webview2.bat'; st_need_link = 'Paste a video link first'
    vid_failed = 'Video — playback failed (download the file)'; tip_fullscreen = 'Full screen'; err_video = 'Could not open video'
    # tray
    tray_open = 'Open'; tray_exit = 'Exit'
  }
}
$script:lang = 'en'
function T($key) {
  $v = $script:L[$script:lang][$key]
  if ($null -eq $v) { $v = $script:L['en'][$key] }
  if ($null -eq $v) { return $key }
  return $v
}

# WebView2 (HD playback) — load the DLLs if setup-webview2.bat installed them
$script:hasWV2 = $false
try {
  $wvc = Join-Path $root 'Microsoft.Web.WebView2.Core.dll'
  $wvw = Join-Path $root 'Microsoft.Web.WebView2.Wpf.dll'
  if ((Test-Path $wvc) -and (Test-Path $wvw)) { Add-Type -Path $wvc; Add-Type -Path $wvw; $script:hasWV2 = $true }
}
catch { $script:hasWV2 = $false }

$ytdlp = Join-Path $root 'yt-dlp.exe'
$ffmpeg = Join-Path $root 'ffmpeg.exe'
$nodeServer = Join-Path $root 'torrent-engine\torrent-server.js'
$teDir = Join-Path $root 'torrent-engine'
$wtDir = Join-Path $teDir 'node_modules\webtorrent\package.json'
$torIdFile = Join-Path $env:TEMP 'ytui_magnet.txt'
$torLog = Join-Path $env:TEMP 'ytui_torrent.log'
$torInstLog = Join-Path $env:TEMP 'ytui_torinstall.log'
$torInstBat = Join-Path $env:TEMP 'ytui_torinstall.bat'
$gifBat = Join-Path $env:TEMP 'ytui_gif.bat'
$gifLog = Join-Path $env:TEMP 'ytui_gif.log'
$settingsPath = Join-Path $root 'ui-settings.json'
$logFile = Join-Path $root 'last-download.log'
$outLog = Join-Path $env:TEMP 'ytui_out.log'
$errLog = Join-Path $env:TEMP 'ytui_err.log'
$previewJson = Join-Path $env:TEMP 'ytui_preview.json'
$searchJson = Join-Path $env:TEMP 'ytui_search.json'

$defaultFolder = Join-Path ([Environment]::GetFolderPath('UserProfile')) 'Downloads'
# option pill labels (functions so Apply-Language can re-read them in the current language)
function Get-QOpts { @((T 'q_max'), (T 'q_1080'), (T 'q_720'), (T 'q_480'), (T 'q_mp3'), (T 'q_flac')) }
function Get-COpts { @((T 'c_none'), (T 'c_file'), 'Chrome', 'Edge', 'Firefox', 'Opera', 'Brave') }
function Get-SOpts { @((T 's_ru'), (T 's_en'), (T 's_both')) }
function Get-TOpts { @((T 't_dark'), (T 't_light')) }
function Get-RateOpts { @((T 'rate_none'), ((T 'rate_fmt') -f 1), ((T 'rate_fmt') -f 3), ((T 'rate_fmt') -f 5), ((T 'rate_fmt') -f 10)) }
function Get-CodecOpts { @((T 'codec_auto'), (T 'codec_h264'), (T 'codec_av1')) }
$qOpts = Get-QOpts
$cOpts = Get-COpts
$cBrowsers = @('', '', 'chrome', 'edge', 'firefox', 'opera', 'brave')
$sOpts = Get-SOpts
$sLangs = @('ru', 'en', 'ru,en')
$tOpts = Get-TOpts
$parOpts = @('1', '2', '3')
$rateOpts = Get-RateOpts
$rateVals = @('', '1M', '3M', '5M', '10M')
$codecOpts = Get-CodecOpts

$saved = $null
if (Test-Path $settingsPath) {
  try { $saved = Get-Content $settingsPath -Raw -Encoding UTF8 | ConvertFrom-Json } catch { $saved = $null }
}

# UI language: saved setting, otherwise Russian for a ru-* system UI culture, English elsewhere
$script:lang = $(if ([System.Globalization.CultureInfo]::CurrentUICulture.Name -like 'ru*') { 'ru' } else { 'en' })
if ($saved -and $saved.lang -and ($saved.lang -eq 'ru' -or $saved.lang -eq 'en')) { $script:lang = [string]$saved.lang }

if (-not (Test-Path $ytdlp)) {
  [System.Windows.MessageBox]::Show(((T 'err_no_ytdlp') -f $ytdlp), (T 'ttl_error')) | Out-Null
  exit 1
}

# ---------------- XAML ----------------
[xml]$xaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="Deviload" Width="800" Height="770"
        WindowStartupLocation="CenterScreen" WindowStyle="None"
        AllowsTransparency="True" Background="Transparent" ResizeMode="NoResize"
        AllowDrop="True"
        FontFamily="Segoe UI Variable Text, Segoe UI">
  <Window.Resources>
    <SolidColorBrush x:Key="TFg" Color="#F5F5F6"/>
    <SolidColorBrush x:Key="TFgDim" Color="#9B9BA4"/>
    <SolidColorBrush x:Key="TFgSub" Color="#6B6B74"/>
    <SolidColorBrush x:Key="TGlass" Color="#0FFFFFFF"/>
    <SolidColorBrush x:Key="TGlassBrd" Color="#1AFFFFFF"/>
    <SolidColorBrush x:Key="TTrack" Color="#21FFFFFF"/>
    <SolidColorBrush x:Key="TPanel" Color="#0BFFFFFF"/>
    <SolidColorBrush x:Key="TPanelBrd" Color="#16FFFFFF"/>
    <SolidColorBrush x:Key="TOverlay" Color="#F70E0E11"/>
    <SolidColorBrush x:Key="TBar" Color="#F00C0C0F"/>
    <SolidColorBrush x:Key="TGlyph" Color="#E7E7EA"/>
    <SolidColorBrush x:Key="TGlyphDim" Color="#8F8F97"/>
    <SolidColorBrush x:Key="TAccent" Color="#F5F5F6"/>
    <SolidColorBrush x:Key="TAccentFg" Color="#131316"/>
    <SolidColorBrush x:Key="TAccentSoft" Color="#30FFFFFF"/>
    <SolidColorBrush x:Key="TKnob" Color="#F0F0F2"/>
    <SolidColorBrush x:Key="TFocus" Color="#59FFFFFF"/>

    <Style x:Key="Lbl" TargetType="TextBlock">
      <Setter Property="Foreground" Value="{DynamicResource TFgDim}"/>
      <Setter Property="FontSize" Value="11.5"/>
      <Setter Property="Margin" Value="2,0,0,7"/>
    </Style>

    <Style x:Key="IconBtn" TargetType="TextBlock">
      <Setter Property="FontFamily" Value="Segoe MDL2 Assets"/>
      <Setter Property="FontSize" Value="15"/>
      <Setter Property="Foreground" Value="{DynamicResource TGlyphDim}"/>
      <Setter Property="VerticalAlignment" Value="Center"/>
      <Setter Property="Cursor" Value="Hand"/>
      <Style.Triggers>
        <Trigger Property="IsMouseOver" Value="True">
          <Setter Property="Foreground" Value="{DynamicResource TFg}"/>
        </Trigger>
      </Style.Triggers>
    </Style>

    <!-- title-bar language toggle: plain text button, the active one is recoloured from code -->
    <Style x:Key="LangBtn" TargetType="Button">
      <Setter Property="Foreground" Value="{DynamicResource TGlyphDim}"/>
      <Setter Property="FontSize" Value="11.5"/>
      <Setter Property="FontWeight" Value="SemiBold"/>
      <Setter Property="Cursor" Value="Hand"/>
      <Setter Property="Padding" Value="2,0"/>
      <Setter Property="Background" Value="Transparent"/>
      <Setter Property="Template">
        <Setter.Value>
          <ControlTemplate TargetType="Button">
            <Border Background="Transparent" Padding="{TemplateBinding Padding}">
              <ContentPresenter VerticalAlignment="Center"/>
            </Border>
          </ControlTemplate>
        </Setter.Value>
      </Setter>
      <Style.Triggers>
        <Trigger Property="IsMouseOver" Value="True">
          <Setter Property="Foreground" Value="{DynamicResource TFg}"/>
        </Trigger>
        <!-- Tag="on" marks the active language (set by Update-LangSwitch) -->
        <Trigger Property="Tag" Value="on">
          <Setter Property="Foreground" Value="{DynamicResource TAccent}"/>
        </Trigger>
      </Style.Triggers>
    </Style>

    <Style x:Key="CheckRow" TargetType="CheckBox">
      <Setter Property="Foreground" Value="{DynamicResource TFg}"/>
      <Setter Property="FontSize" Value="12.5"/>
      <Setter Property="Cursor" Value="Hand"/>
      <Setter Property="Margin" Value="0,0,0,6"/>
      <Setter Property="Template">
        <Setter.Value>
          <ControlTemplate TargetType="CheckBox">
            <Border x:Name="b" CornerRadius="8" Padding="10,7" Background="{DynamicResource TGlass}" BorderBrush="{DynamicResource TGlassBrd}" BorderThickness="1">
              <StackPanel Orientation="Horizontal">
                <Border x:Name="box" Width="16" Height="16" CornerRadius="4" Background="Transparent" BorderBrush="{DynamicResource TGlassBrd}" BorderThickness="1.5" VerticalAlignment="Center">
                  <TextBlock x:Name="tick" Text="&#xE73E;" FontFamily="Segoe MDL2 Assets" FontSize="10" Foreground="{DynamicResource TAccentFg}" HorizontalAlignment="Center" VerticalAlignment="Center" Visibility="Collapsed"/>
                </Border>
                <ContentPresenter VerticalAlignment="Center" Margin="10,0,0,0"/>
              </StackPanel>
            </Border>
            <ControlTemplate.Triggers>
              <Trigger Property="IsMouseOver" Value="True">
                <Setter TargetName="b" Property="Background" Value="{DynamicResource TTrack}"/>
              </Trigger>
              <Trigger Property="IsChecked" Value="True">
                <Setter TargetName="box" Property="Background" Value="{DynamicResource TAccent}"/>
                <Setter TargetName="box" Property="BorderBrush" Value="{DynamicResource TAccent}"/>
                <Setter TargetName="tick" Property="Visibility" Value="Visible"/>
              </Trigger>
            </ControlTemplate.Triggers>
          </ControlTemplate>
        </Setter.Value>
      </Setter>
    </Style>

    <Style x:Key="GlassInput" TargetType="TextBox">
      <Setter Property="Foreground" Value="{DynamicResource TFg}"/>
      <Setter Property="CaretBrush" Value="{DynamicResource TFg}"/>
      <Setter Property="FontSize" Value="13"/>
      <Setter Property="Height" Value="40"/>
      <Setter Property="Template">
        <Setter.Value>
          <ControlTemplate TargetType="TextBox">
            <Border x:Name="bd" CornerRadius="10" Background="{DynamicResource TGlass}" BorderBrush="{DynamicResource TGlassBrd}" BorderThickness="1" Padding="12,0">
              <ScrollViewer x:Name="PART_ContentHost" VerticalAlignment="Center"/>
            </Border>
            <ControlTemplate.Triggers>
              <Trigger Property="IsKeyboardFocused" Value="True">
                <Setter TargetName="bd" Property="BorderBrush" Value="{DynamicResource TFocus}"/>
              </Trigger>
            </ControlTemplate.Triggers>
          </ControlTemplate>
        </Setter.Value>
      </Setter>
    </Style>

    <Style x:Key="MultiInput" TargetType="TextBox">
      <Setter Property="Foreground" Value="{DynamicResource TFg}"/>
      <Setter Property="CaretBrush" Value="{DynamicResource TFg}"/>
      <Setter Property="FontSize" Value="13"/>
      <Setter Property="AcceptsReturn" Value="True"/>
      <Setter Property="TextWrapping" Value="Wrap"/>
      <Setter Property="VerticalScrollBarVisibility" Value="Auto"/>
      <Setter Property="Template">
        <Setter.Value>
          <ControlTemplate TargetType="TextBox">
            <Border x:Name="bd" CornerRadius="10" Background="{DynamicResource TGlass}" BorderBrush="{DynamicResource TGlassBrd}" BorderThickness="1" Padding="12,8">
              <ScrollViewer x:Name="PART_ContentHost"/>
            </Border>
            <ControlTemplate.Triggers>
              <Trigger Property="IsKeyboardFocused" Value="True">
                <Setter TargetName="bd" Property="BorderBrush" Value="{DynamicResource TFocus}"/>
              </Trigger>
            </ControlTemplate.Triggers>
          </ControlTemplate>
        </Setter.Value>
      </Setter>
    </Style>

    <Style x:Key="Pill" TargetType="RadioButton">
      <Setter Property="Margin" Value="0,0,8,8"/>
      <Setter Property="Foreground" Value="{DynamicResource TFgDim}"/>
      <Setter Property="FontSize" Value="12.5"/>
      <Setter Property="Cursor" Value="Hand"/>
      <Setter Property="Template">
        <Setter.Value>
          <ControlTemplate TargetType="RadioButton">
            <Border x:Name="b" CornerRadius="9" Padding="13,7" Background="{DynamicResource TGlass}" BorderBrush="{DynamicResource TGlassBrd}" BorderThickness="1">
              <ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center"/>
            </Border>
            <ControlTemplate.Triggers>
              <Trigger Property="IsMouseOver" Value="True">
                <Setter TargetName="b" Property="Background" Value="{DynamicResource TTrack}"/>
              </Trigger>
              <Trigger Property="IsChecked" Value="True">
                <Setter TargetName="b" Property="Background" Value="{DynamicResource TAccent}"/>
                <Setter TargetName="b" Property="BorderBrush" Value="{DynamicResource TAccent}"/>
                <Setter Property="Foreground" Value="{DynamicResource TAccentFg}"/>
              </Trigger>
            </ControlTemplate.Triggers>
          </ControlTemplate>
        </Setter.Value>
      </Setter>
    </Style>

    <Style x:Key="Toggle" TargetType="CheckBox">
      <Setter Property="Foreground" Value="{DynamicResource TFg}"/>
      <Setter Property="FontSize" Value="13"/>
      <Setter Property="Cursor" Value="Hand"/>
      <Setter Property="Template">
        <Setter.Value>
          <ControlTemplate TargetType="CheckBox">
            <StackPanel Orientation="Horizontal">
              <Border x:Name="track" Width="40" Height="24" CornerRadius="12" Background="{DynamicResource TTrack}">
                <Border x:Name="knob" Width="18" Height="18" CornerRadius="9" Background="{DynamicResource TKnob}" HorizontalAlignment="Left" Margin="3,0,0,0"/>
              </Border>
              <ContentPresenter VerticalAlignment="Center" Margin="10,0,0,0"/>
            </StackPanel>
            <ControlTemplate.Triggers>
              <Trigger Property="IsChecked" Value="True">
                <Setter TargetName="track" Property="Background" Value="{DynamicResource TAccent}"/>
                <Setter TargetName="knob" Property="Background" Value="{DynamicResource TAccentFg}"/>
                <Setter TargetName="knob" Property="HorizontalAlignment" Value="Right"/>
                <Setter TargetName="knob" Property="Margin" Value="0,0,3,0"/>
              </Trigger>
            </ControlTemplate.Triggers>
          </ControlTemplate>
        </Setter.Value>
      </Setter>
    </Style>

    <Style x:Key="Primary" TargetType="Button">
      <Setter Property="Foreground" Value="{DynamicResource TAccentFg}"/>
      <Setter Property="FontWeight" Value="SemiBold"/>
      <Setter Property="FontSize" Value="13.5"/>
      <Setter Property="Height" Value="42"/>
      <Setter Property="Cursor" Value="Hand"/>
      <Setter Property="Template">
        <Setter.Value>
          <ControlTemplate TargetType="Button">
            <Border x:Name="bd" CornerRadius="10" Padding="22,0" Background="{DynamicResource TAccent}">
              <ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center"/>
            </Border>
            <ControlTemplate.Triggers>
              <Trigger Property="IsMouseOver" Value="True">
                <Setter TargetName="bd" Property="Opacity" Value="0.88"/>
              </Trigger>
              <Trigger Property="IsEnabled" Value="False">
                <Setter TargetName="bd" Property="Opacity" Value="0.3"/>
              </Trigger>
            </ControlTemplate.Triggers>
          </ControlTemplate>
        </Setter.Value>
      </Setter>
    </Style>

    <Style x:Key="Ghost" TargetType="Button">
      <Setter Property="Foreground" Value="{DynamicResource TFg}"/>
      <Setter Property="FontSize" Value="13"/>
      <Setter Property="Height" Value="42"/>
      <Setter Property="Cursor" Value="Hand"/>
      <Setter Property="Template">
        <Setter.Value>
          <ControlTemplate TargetType="Button">
            <Border x:Name="bd" CornerRadius="10" Padding="16,0" Background="{DynamicResource TGlass}" BorderBrush="{DynamicResource TGlassBrd}" BorderThickness="1">
              <ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center"/>
            </Border>
            <ControlTemplate.Triggers>
              <Trigger Property="IsMouseOver" Value="True">
                <Setter TargetName="bd" Property="Background" Value="{DynamicResource TTrack}"/>
              </Trigger>
              <Trigger Property="IsEnabled" Value="False"><Setter TargetName="bd" Property="Opacity" Value="0.35"/></Trigger>
            </ControlTemplate.Triggers>
          </ControlTemplate>
        </Setter.Value>
      </Setter>
    </Style>

    <Style x:Key="GlassBar" TargetType="ProgressBar">
      <Setter Property="Height" Value="6"/>
      <Setter Property="Template">
        <Setter.Value>
          <ControlTemplate TargetType="ProgressBar">
            <Border CornerRadius="3" Background="{DynamicResource TTrack}" ClipToBounds="True">
              <Grid>
                <Border x:Name="PART_Track"/>
                <Border x:Name="PART_Indicator" HorizontalAlignment="Left" CornerRadius="3" Background="{DynamicResource TAccent}"/>
              </Grid>
            </Border>
          </ControlTemplate>
        </Setter.Value>
      </Setter>
    </Style>

    <Style x:Key="TrimHandle" TargetType="Thumb">
      <Setter Property="Cursor" Value="SizeWE"/>
      <Setter Property="Template">
        <Setter.Value>
          <ControlTemplate TargetType="Thumb">
            <Border CornerRadius="4" Background="{DynamicResource TKnob}" BorderBrush="#40000000" BorderThickness="1"/>
          </ControlTemplate>
        </Setter.Value>
      </Setter>
    </Style>

    <Style TargetType="Slider">
      <Setter Property="Height" Value="22"/>
      <Setter Property="Template">
        <Setter.Value>
          <ControlTemplate TargetType="Slider">
            <Grid Background="Transparent">
              <Border Height="4" CornerRadius="2" Background="{DynamicResource TTrack}" VerticalAlignment="Center"/>
              <Track x:Name="PART_Track">
                <Track.DecreaseRepeatButton>
                  <RepeatButton Command="Slider.DecreaseLarge" Focusable="False">
                    <RepeatButton.Template>
                      <ControlTemplate TargetType="RepeatButton">
                        <Border Height="4" CornerRadius="2" Background="{DynamicResource TAccent}" VerticalAlignment="Center"/>
                      </ControlTemplate>
                    </RepeatButton.Template>
                  </RepeatButton>
                </Track.DecreaseRepeatButton>
                <Track.IncreaseRepeatButton>
                  <RepeatButton Command="Slider.IncreaseLarge" Focusable="False">
                    <RepeatButton.Template>
                      <ControlTemplate TargetType="RepeatButton">
                        <Border Background="Transparent" Height="22"/>
                      </ControlTemplate>
                    </RepeatButton.Template>
                  </RepeatButton>
                </Track.IncreaseRepeatButton>
                <Track.Thumb>
                  <Thumb Width="14" Height="14">
                    <Thumb.Template>
                      <ControlTemplate TargetType="Thumb">
                        <Ellipse Fill="{DynamicResource TKnob}" Stroke="#40000000" StrokeThickness="1"/>
                      </ControlTemplate>
                    </Thumb.Template>
                  </Thumb>
                </Track.Thumb>
              </Track>
            </Grid>
          </ControlTemplate>
        </Setter.Value>
      </Setter>
    </Style>

    <Style TargetType="ScrollBar">
      <Setter Property="Background" Value="Transparent"/>
      <Setter Property="Width" Value="7"/>
      <Setter Property="Template">
        <Setter.Value>
          <ControlTemplate TargetType="ScrollBar">
            <Grid Background="Transparent">
              <Track x:Name="PART_Track" IsDirectionReversed="True">
                <Track.DecreaseRepeatButton>
                  <RepeatButton Command="ScrollBar.PageUpCommand" Focusable="False">
                    <RepeatButton.Template><ControlTemplate TargetType="RepeatButton"><Border Background="Transparent"/></ControlTemplate></RepeatButton.Template>
                  </RepeatButton>
                </Track.DecreaseRepeatButton>
                <Track.IncreaseRepeatButton>
                  <RepeatButton Command="ScrollBar.PageDownCommand" Focusable="False">
                    <RepeatButton.Template><ControlTemplate TargetType="RepeatButton"><Border Background="Transparent"/></ControlTemplate></RepeatButton.Template>
                  </RepeatButton>
                </Track.IncreaseRepeatButton>
                <Track.Thumb>
                  <Thumb>
                    <Thumb.Template><ControlTemplate TargetType="Thumb"><Border CornerRadius="3" Margin="1" Background="{DynamicResource TTrack}"/></ControlTemplate></Thumb.Template>
                  </Thumb>
                </Track.Thumb>
              </Track>
            </Grid>
          </ControlTemplate>
        </Setter.Value>
      </Setter>
      <Style.Triggers>
        <Trigger Property="Orientation" Value="Horizontal">
          <Setter Property="Width" Value="Auto"/>
          <Setter Property="Height" Value="7"/>
          <Setter Property="Template">
            <Setter.Value>
              <ControlTemplate TargetType="ScrollBar">
                <Grid Background="Transparent">
                  <Track x:Name="PART_Track">
                    <Track.DecreaseRepeatButton>
                      <RepeatButton Command="ScrollBar.PageLeftCommand" Focusable="False">
                        <RepeatButton.Template><ControlTemplate TargetType="RepeatButton"><Border Background="Transparent"/></ControlTemplate></RepeatButton.Template>
                      </RepeatButton>
                    </Track.DecreaseRepeatButton>
                    <Track.IncreaseRepeatButton>
                      <RepeatButton Command="ScrollBar.PageRightCommand" Focusable="False">
                        <RepeatButton.Template><ControlTemplate TargetType="RepeatButton"><Border Background="Transparent"/></ControlTemplate></RepeatButton.Template>
                      </RepeatButton>
                    </Track.IncreaseRepeatButton>
                    <Track.Thumb>
                      <Thumb>
                        <Thumb.Template><ControlTemplate TargetType="Thumb"><Border CornerRadius="3" Margin="1" Background="{DynamicResource TTrack}"/></ControlTemplate></Thumb.Template>
                      </Thumb>
                    </Track.Thumb>
                  </Track>
                </Grid>
              </ControlTemplate>
            </Setter.Value>
          </Setter>
        </Trigger>
      </Style.Triggers>
    </Style>
  </Window.Resources>

  <Grid>
    <Border x:Name="cardBorder" CornerRadius="16" Margin="0" BorderThickness="1" BorderBrush="#1FFFFFFF" Background="#EE0E0E11">

      <Grid>
        <Grid.Clip>
          <RectangleGeometry x:Name="rootClip" Rect="0,0,800,770" RadiusX="16" RadiusY="16"/>
        </Grid.Clip>

        <DockPanel Margin="0">
          <Border x:Name="titleBar" DockPanel.Dock="Top" Height="46" Background="#01FFFFFF">
            <Grid>
              <StackPanel Orientation="Horizontal" VerticalAlignment="Center" Margin="20,0,0,0">
                <Border Width="24" Height="24" CornerRadius="6" Margin="0,0,10,0" BorderBrush="{DynamicResource TGlassBrd}" BorderThickness="1" Background="{DynamicResource TGlass}">
                  <Border.Clip>
                    <RectangleGeometry Rect="0,0,24,24" RadiusX="6" RadiusY="6"/>
                  </Border.Clip>
                  <Image x:Name="headerLogo" Stretch="UniformToFill" RenderOptions.BitmapScalingMode="HighQuality"/>
                </Border>
                <TextBlock Text="Deviload" Foreground="{DynamicResource TFg}" FontSize="13" FontWeight="SemiBold"
                           VerticalAlignment="Center"/>
              </StackPanel>
              <StackPanel Orientation="Horizontal" HorizontalAlignment="Right" VerticalAlignment="Center" Margin="0,0,18,0">
                <Border x:Name="ytLogoBtn" Background="Transparent" Cursor="Hand" VerticalAlignment="Center" Margin="0,0,18,0" >
                  <StackPanel Orientation="Horizontal" VerticalAlignment="Center">
                    <Border Width="26" Height="18" CornerRadius="5" Background="#E5484D" VerticalAlignment="Center">
                      <Viewbox Width="8" Height="8" HorizontalAlignment="Center" VerticalAlignment="Center">
                        <Path Data="M0,0 L10,6 L0,12 Z" Fill="White"/>
                      </Viewbox>
                    </Border>
                    <TextBlock Text="YouTube" Foreground="{DynamicResource TFgDim}" FontSize="12.5" FontWeight="SemiBold" VerticalAlignment="Center" Margin="7,0,0,0"/>
                  </StackPanel>
                </Border>
                <StackPanel x:Name="langSwitch" Orientation="Horizontal" VerticalAlignment="Center" Margin="0,0,18,0">
                  <Button x:Name="langRu" Content="RU" Style="{StaticResource LangBtn}"/>
                  <TextBlock Text="|" Foreground="{DynamicResource TFgSub}" FontSize="11" VerticalAlignment="Center" Margin="6,0,6,1"/>
                  <Button x:Name="langEn" Content="EN" Style="{StaticResource LangBtn}"/>
                </StackPanel>
                <TextBlock x:Name="historyBtn" Text="&#xE81C;" Style="{StaticResource IconBtn}" Margin="0,0,16,0"/>
                <TextBlock x:Name="searchBtn" Text="&#xE721;" Style="{StaticResource IconBtn}" Margin="0,0,16,0"/>
                <TextBlock x:Name="gearBtn" Text="&#xE713;" Style="{StaticResource IconBtn}"/>
                <Border Width="1" Height="16" Background="{DynamicResource TGlassBrd}" Margin="16,0,16,0"/>
                <TextBlock x:Name="dotMin" Text="&#xE949;" Style="{StaticResource IconBtn}" FontSize="11.5" Margin="0,0,16,0"/>
                <TextBlock x:Name="dotClose" Text="&#xE8BB;" Style="{StaticResource IconBtn}" FontSize="11.5"/>
              </StackPanel>
            </Grid>
          </Border>

          <ScrollViewer VerticalScrollBarVisibility="Auto">
          <StackPanel Margin="28,10,28,22">
            <TextBlock x:Name="lblLinks" Text="" Style="{StaticResource Lbl}"/>
            <Grid>
              <Grid.ColumnDefinitions>
                <ColumnDefinition Width="*"/>
                <ColumnDefinition Width="Auto"/>
              </Grid.ColumnDefinitions>
              <TextBox x:Name="urlBox" Grid.Column="0" Style="{StaticResource MultiInput}" Height="74" VerticalAlignment="Top"/>
              <TextBlock x:Name="urlHint" Grid.Column="0" Text="" Foreground="{DynamicResource TFgSub}" FontSize="13" Margin="14,10,0,0" VerticalAlignment="Top" IsHitTestVisible="False"/>
              <StackPanel Grid.Column="1" Margin="10,0,0,0" VerticalAlignment="Top">
                <Button x:Name="pasteBtn" Content="" Style="{StaticResource Ghost}" Width="104" Height="34"/>
                <Button x:Name="clearBtn" Content="" Style="{StaticResource Ghost}" Width="104" Height="34" Margin="0,6,0,0"/>
              </StackPanel>
            </Grid>

            <Button x:Name="torrentBtn" Content="" Style="{StaticResource Ghost}" Height="34" HorizontalAlignment="Left" Margin="0,10,0,0"/>

            <TextBlock x:Name="lblQuality" Text="" Style="{StaticResource Lbl}" Margin="2,16,0,7"/>
            <WrapPanel x:Name="qualityPanel"/>

            <StackPanel x:Name="audioTracksContainer" Visibility="Collapsed" Margin="0,10,0,0">
              <TextBlock x:Name="lblAudio" Text="" Style="{StaticResource Lbl}" Margin="2,0,0,6"/>
              <WrapPanel x:Name="audioTracksPanel"/>
            </StackPanel>

            <TextBlock x:Name="lblTrim" Text="" Style="{StaticResource Lbl}" Margin="2,14,0,8"/>
            <Canvas x:Name="trimTrack" Height="30" Width="700" HorizontalAlignment="Left">
              <Border Canvas.Left="0" Canvas.Top="11" Width="700" Height="8" CornerRadius="4" Background="{DynamicResource TTrack}"/>
              <Border x:Name="trimSel" Canvas.Left="6" Canvas.Top="11" Width="688" Height="8" CornerRadius="4" Background="{DynamicResource TAccentSoft}"/>
              <Thumb x:Name="trimH1" Canvas.Left="0" Canvas.Top="3" Width="12" Height="24" Style="{StaticResource TrimHandle}"/>
              <Thumb x:Name="trimH2" Canvas.Left="688" Canvas.Top="3" Width="12" Height="24" Style="{StaticResource TrimHandle}"/>
            </Canvas>
            <Grid Margin="0,8,0,0">
              <Grid.ColumnDefinitions>
                <ColumnDefinition Width="*"/>
                <ColumnDefinition Width="Auto"/>
                <ColumnDefinition Width="Auto"/>
              </Grid.ColumnDefinitions>
              <TextBlock x:Name="trimLabel" Grid.Column="0" Text="" Foreground="{DynamicResource TFgDim}" FontSize="12" VerticalAlignment="Center" TextTrimming="CharacterEllipsis" Margin="2,0,8,0"/>
              <Button x:Name="chaptersBtn" Grid.Column="1" Content="" Style="{StaticResource Ghost}" Height="32" Margin="0,0,8,0" Visibility="Collapsed"/>
              <Button x:Name="gifBtn" Grid.Column="2" Content="" Style="{StaticResource Ghost}" Height="32" Width="200"/>
            </Grid>

            <Grid Margin="2,14,0,0">
              <Grid.ColumnDefinitions>
                <ColumnDefinition Width="Auto"/>
                <ColumnDefinition Width="*"/>
                <ColumnDefinition Width="Auto"/>
              </Grid.ColumnDefinitions>
              <CheckBox x:Name="playlistToggle" Grid.Column="0" Content="" Style="{StaticResource Toggle}" VerticalAlignment="Center"/>
              <Grid Grid.Column="1" Margin="12,0,12,0">
                <TextBox x:Name="playlistRangeBox" Style="{StaticResource GlassInput}" Height="30" Visibility="Collapsed"/>
                <TextBlock x:Name="playlistRangeHint" Text="" Foreground="{DynamicResource TFgSub}" FontSize="11" Margin="14,0,0,0" VerticalAlignment="Center" IsHitTestVisible="False" Visibility="Collapsed"/>
              </Grid>
              <CheckBox x:Name="splitChaptersToggle" Grid.Column="2" Content="" Style="{StaticResource Toggle}" VerticalAlignment="Center"/>
            </Grid>

            <Grid Margin="2,16,0,7">
              <TextBlock x:Name="lblFolder" Text="" Style="{StaticResource Lbl}" VerticalAlignment="Center"/>
              <StackPanel Orientation="Horizontal" HorizontalAlignment="Right">
                <TextBlock x:Name="presetDownloads" Text="" Foreground="{DynamicResource TFgDim}" FontSize="11" Margin="0,0,12,0" Cursor="Hand"/>
                <TextBlock x:Name="presetMusic" Text="" Foreground="{DynamicResource TFgDim}" FontSize="11" Margin="0,0,12,0" Cursor="Hand"/>
                <TextBlock x:Name="presetDesktop" Text="" Foreground="{DynamicResource TFgDim}" FontSize="11" Cursor="Hand"/>
              </StackPanel>
            </Grid>
            <Grid>
              <Grid.ColumnDefinitions>
                <ColumnDefinition Width="*"/>
                <ColumnDefinition Width="Auto"/>
              </Grid.ColumnDefinitions>
              <TextBox x:Name="folderBox" Grid.Column="0" Style="{StaticResource GlassInput}"/>
              <Button x:Name="browseBtn" Grid.Column="1" Content="" Style="{StaticResource Ghost}" Width="104" Margin="10,0,0,0"/>
            </Grid>

            <Grid Margin="0,18,0,0">
              <Grid.ColumnDefinitions>
                <ColumnDefinition Width="*"/>
                <ColumnDefinition Width="Auto"/>
                <ColumnDefinition Width="Auto"/>
                <ColumnDefinition Width="Auto"/>
                <ColumnDefinition Width="Auto"/>
              </Grid.ColumnDefinitions>
              <Button x:Name="downloadBtn" Grid.Column="0" Content="" Style="{StaticResource Primary}"/>
              <Button x:Name="cancelBtn" Grid.Column="1" Content="" Style="{StaticResource Ghost}" Width="92" Margin="10,0,0,0" IsEnabled="False"/>
              <Button x:Name="logBtn" Grid.Column="2" Content="" Style="{StaticResource Ghost}" Width="72" Margin="10,0,0,0"/>
              <Button x:Name="openBtn" Grid.Column="3" Content="" Style="{StaticResource Ghost}" Width="88" Margin="10,0,0,0"/>
              <Button x:Name="updateBtn" Grid.Column="4" Content="" Style="{StaticResource Ghost}" Width="104" Margin="10,0,0,0"/>
            </Grid>

            <Border CornerRadius="12" Background="{DynamicResource TPanel}" BorderBrush="{DynamicResource TPanelBrd}" BorderThickness="1" Padding="18,14" Margin="0,16,0,0">
              <StackPanel>
                <ScrollViewer x:Name="queueScroll" MaxHeight="92" VerticalScrollBarVisibility="Auto" Margin="0,0,0,12" Visibility="Collapsed">
                  <StackPanel x:Name="queuePanel"/>
                </ScrollViewer>
                <Grid>
                  <StackPanel Orientation="Horizontal">
                    <Ellipse x:Name="statusDot" Width="9" Height="9" Fill="#7A7A83" VerticalAlignment="Center" Margin="0,0,10,0"/>
                    <TextBlock x:Name="statusText" Text="" Foreground="{DynamicResource TFg}" FontSize="14" FontWeight="SemiBold" VerticalAlignment="Center"/>
                  </StackPanel>
                  <TextBlock x:Name="clearQueueBtn" Text="" HorizontalAlignment="Right" VerticalAlignment="Center" Foreground="{DynamicResource TFgDim}" FontSize="12" Cursor="Hand" Visibility="Collapsed"/>
                </Grid>
                <TextBlock x:Name="itemTitle" Text="" Foreground="{DynamicResource TFgDim}" FontSize="12" Margin="19,5,0,0" TextTrimming="CharacterEllipsis" Visibility="Collapsed"/>
                <ProgressBar x:Name="progress" Style="{StaticResource GlassBar}" Minimum="0" Maximum="100" Value="0" Margin="0,12,0,0" Visibility="Collapsed"/>
                <TextBlock x:Name="detailText" Text="" Foreground="{DynamicResource TFgDim}" FontSize="12" FontWeight="Medium" Margin="2,8,0,0" Visibility="Collapsed"/>
                <Button x:Name="openFileBtn" Content="" Style="{StaticResource Ghost}" Height="36" Width="170" HorizontalAlignment="Left" Margin="0,10,0,0" Visibility="Collapsed"/>
              </StackPanel>
            </Border>
          </StackPanel>
          </ScrollViewer>
        </DockPanel>
      </Grid>
    </Border>

    <!-- preview mini-player (Spotify-style, bottom) -->
    <Border x:Name="previewCard" CornerRadius="12" Background="{DynamicResource TBar}" BorderBrush="{DynamicResource TGlassBrd}" BorderThickness="1"
            HorizontalAlignment="Stretch" VerticalAlignment="Bottom" Margin="14,0,14,14" Padding="12,10" Visibility="Collapsed">
      <Grid>
        <Grid.ColumnDefinitions>
          <ColumnDefinition Width="Auto"/>
          <ColumnDefinition Width="*"/>
          <ColumnDefinition Width="Auto"/>
        </Grid.ColumnDefinitions>

        <Border x:Name="artBtn" Grid.Column="0" Width="56" Height="56" CornerRadius="8" ClipToBounds="True" Background="#33000000" VerticalAlignment="Center" Cursor="Hand">
          <Grid>
            <Image x:Name="previewImg" Stretch="UniformToFill"/>
            <Border Background="#50000000"/>
            <Path Data="M0,0 L10,6 L0,12 Z" Fill="#F2FFFFFF" Stretch="Uniform" Width="17" Height="17" HorizontalAlignment="Center" VerticalAlignment="Center"/>
          </Grid>
        </Border>

        <StackPanel Grid.Column="1" Margin="14,0,6,0" VerticalAlignment="Center">
          <Grid Margin="2,0,0,5">
            <Grid.ColumnDefinitions>
              <ColumnDefinition Width="*"/>
              <ColumnDefinition Width="Auto"/>
            </Grid.ColumnDefinitions>
            <TextBlock x:Name="previewTitle" Grid.Column="0" Text="" Foreground="{DynamicResource TFg}" FontSize="12" TextTrimming="CharacterEllipsis" TextWrapping="NoWrap"/>
            <TextBlock x:Name="previewSize" Grid.Column="1" Text="" Foreground="{DynamicResource TFgSub}" FontSize="11" VerticalAlignment="Center" Margin="10,0,0,0"/>
          </Grid>
          <StackPanel Orientation="Horizontal" HorizontalAlignment="Center" VerticalAlignment="Center" Margin="0,0,0,7">
            <TextBlock x:Name="btnPrev" Text="&#xE892;" FontFamily="Segoe MDL2 Assets" FontSize="16" Foreground="{DynamicResource TGlyph}" Cursor="Hand" VerticalAlignment="Center" Margin="0,0,18,0"/>
            <TextBlock x:Name="btnRew" Text="&#xEB9E;" FontFamily="Segoe MDL2 Assets" FontSize="17" Foreground="{DynamicResource TGlyph}" Cursor="Hand" VerticalAlignment="Center" Margin="0,0,18,0"/>
            <Border x:Name="btnPlay" Width="42" Height="42" CornerRadius="21" Background="{DynamicResource TAccent}" Cursor="Hand">
              <TextBlock x:Name="playGlyph" Text="&#xE768;" FontFamily="Segoe MDL2 Assets" FontSize="17" Foreground="{DynamicResource TAccentFg}" HorizontalAlignment="Center" VerticalAlignment="Center"/>
            </Border>
            <TextBlock x:Name="btnFf" Text="&#xEB9D;" FontFamily="Segoe MDL2 Assets" FontSize="17" Foreground="{DynamicResource TGlyph}" Cursor="Hand" VerticalAlignment="Center" Margin="18,0,0,0"/>
            <TextBlock x:Name="btnNext" Text="&#xE893;" FontFamily="Segoe MDL2 Assets" FontSize="16" Foreground="{DynamicResource TGlyph}" Cursor="Hand" VerticalAlignment="Center" Margin="18,0,0,0"/>
          </StackPanel>
          <Grid>
            <Grid.ColumnDefinitions>
              <ColumnDefinition Width="Auto"/>
              <ColumnDefinition Width="*"/>
              <ColumnDefinition Width="Auto"/>
            </Grid.ColumnDefinitions>
            <TextBlock x:Name="curTime" Grid.Column="0" Text="0:00" Foreground="{DynamicResource TFgDim}" FontSize="11" VerticalAlignment="Center" Margin="2,0,10,0"/>
            <ProgressBar x:Name="playerBar" Grid.Column="1" Style="{StaticResource GlassBar}" Height="6" Minimum="0" Maximum="100" Value="0" Cursor="Hand" VerticalAlignment="Center"/>
            <TextBlock x:Name="totalTime" Grid.Column="2" Text="0:00" Foreground="{DynamicResource TFgDim}" FontSize="11" VerticalAlignment="Center" Margin="10,0,2,0"/>
          </Grid>
        </StackPanel>

        <StackPanel Grid.Column="2" VerticalAlignment="Stretch" Margin="8,0,2,0">
          <TextBlock x:Name="previewClose" Text="✕" Foreground="#80FFFFFF" FontSize="12" HorizontalAlignment="Right" Cursor="Hand"/>
          <TextBlock x:Name="downloadThumbBtn" Text="&#xEB9F;" FontFamily="Segoe MDL2 Assets" Foreground="{DynamicResource TGlyph}" FontSize="14" HorizontalAlignment="Right" VerticalAlignment="Bottom" Cursor="Hand" Margin="0,22,0,0"/>
        </StackPanel>
      </Grid>
    </Border>

    <!-- video -->
    <Grid x:Name="videoOverlay" Visibility="Collapsed" Background="#CC000000">
      <Border CornerRadius="12" Background="#FF080810" BorderBrush="#33FFFFFF" BorderThickness="1" Width="600" Height="360" VerticalAlignment="Center" HorizontalAlignment="Center">
        <Grid>
          <Rectangle x:Name="videoRect"/>
          <TextBlock x:Name="videoClose" Text="✕" Foreground="White" FontSize="15" HorizontalAlignment="Right" VerticalAlignment="Top" Margin="0,10,14,0" Cursor="Hand"/>
        </Grid>
      </Border>
    </Grid>

    <!-- YouTube search -->
    <Grid x:Name="searchOverlay" Visibility="Collapsed" Background="#A6000000">
      <Border Width="640" Height="520" CornerRadius="16" Background="{DynamicResource TOverlay}" BorderBrush="{DynamicResource TGlassBrd}" BorderThickness="1" VerticalAlignment="Center" HorizontalAlignment="Center" Padding="22,20">
        <DockPanel>
          <StackPanel DockPanel.Dock="Top" Orientation="Horizontal" Margin="0,0,0,16">
            <Border Width="34" Height="24" CornerRadius="7" Background="#E5484D" VerticalAlignment="Center">
              <Viewbox Width="11" Height="11" HorizontalAlignment="Center" VerticalAlignment="Center">
                <Path Data="M0,0 L10,6 L0,12 Z" Fill="White"/>
              </Viewbox>
            </Border>
            <TextBlock x:Name="searchTitle" Text="" Foreground="{DynamicResource TFg}" FontSize="16" FontWeight="SemiBold" VerticalAlignment="Center" Margin="10,0,0,0"/>
          </StackPanel>
          <Grid DockPanel.Dock="Top" Margin="0,0,0,14">
            <Grid.ColumnDefinitions>
              <ColumnDefinition Width="*"/>
              <ColumnDefinition Width="Auto"/>
            </Grid.ColumnDefinitions>
            <TextBox x:Name="searchBox" Grid.Column="0" Style="{StaticResource GlassInput}"/>
            <Button x:Name="searchGo" Grid.Column="1" Content="" Style="{StaticResource Primary}" Width="110" Margin="10,0,0,0"/>
          </Grid>
          <Button x:Name="searchCloseBtn" DockPanel.Dock="Bottom" Content="" Style="{StaticResource Ghost}" Width="130" HorizontalAlignment="Right" Margin="0,14,0,0"/>
          <ScrollViewer VerticalScrollBarVisibility="Auto">
            <StackPanel x:Name="searchResults"/>
          </ScrollViewer>
        </DockPanel>
      </Border>
    </Grid>

    <!-- settings overlay -->
    <Grid x:Name="settingsOverlay" Visibility="Collapsed" Background="#A6000000">
      <Border Width="620" CornerRadius="16" Background="{DynamicResource TOverlay}" BorderBrush="{DynamicResource TGlassBrd}" BorderThickness="1"
              VerticalAlignment="Center" HorizontalAlignment="Center" Padding="26,22">
        <DockPanel>
          <TextBlock x:Name="settingsTitle" DockPanel.Dock="Top" Text="" Foreground="{DynamicResource TFg}" FontSize="16" FontWeight="SemiBold" Margin="0,0,0,14"/>
          <Button x:Name="settingsClose" DockPanel.Dock="Bottom" Content="" Style="{StaticResource Primary}" Width="150" HorizontalAlignment="Right" Margin="0,16,0,0"/>
          <ScrollViewer VerticalScrollBarVisibility="Auto" MaxHeight="540">
            <StackPanel Margin="0,0,10,0">
              <TextBlock x:Name="lblParallel" Text="" Style="{StaticResource Lbl}"/>
              <WrapPanel x:Name="parallelPanel"/>
              <TextBlock x:Name="lblRate" Text="" Style="{StaticResource Lbl}" Margin="2,12,0,7"/>
              <WrapPanel x:Name="ratePanel"/>
              <TextBlock x:Name="lblCodec" Text="" Style="{StaticResource Lbl}" Margin="2,12,0,7"/>
              <WrapPanel x:Name="codecPanel"/>
              <CheckBox x:Name="archiveToggle" Content="" Style="{StaticResource Toggle}" Margin="0,14,0,0"/>
              <CheckBox x:Name="clipWatchToggle" Content="" Style="{StaticResource Toggle}" IsChecked="True" Margin="0,12,0,0"/>
              <TextBlock x:Name="lblCookies" Text="" Style="{StaticResource Lbl}" Margin="2,16,0,7"/>
              <WrapPanel x:Name="cookiesPanel"/>
              <TextBlock x:Name="lblSb" Text="" Style="{StaticResource Lbl}" Margin="2,12,0,9"/>
              <CheckBox x:Name="sponsorblockToggle" Content="" Style="{StaticResource Toggle}"/>
              <TextBlock x:Name="lblTagger" Text="" Style="{StaticResource Lbl}" Margin="2,14,0,9"/>
              <CheckBox x:Name="smartTaggerToggle" Content="" Style="{StaticResource Toggle}" IsChecked="True"/>
              <TextBlock x:Name="lblSubs" Text="" Style="{StaticResource Lbl}" Margin="2,14,0,9"/>
              <CheckBox x:Name="subsToggle" Content="" Style="{StaticResource Toggle}"/>
              <WrapPanel x:Name="subsLangPanel" Margin="0,12,0,0"/>
              <TextBlock x:Name="lblTheme" Text="" Style="{StaticResource Lbl}" Margin="2,14,0,9"/>
              <WrapPanel x:Name="themePanel"/>
              <TextBlock x:Name="lblOpacity" Text="" Style="{StaticResource Lbl}" Margin="2,14,0,8"/>
              <Slider x:Name="opacitySlider" Minimum="0" Maximum="100" Value="50" Width="320" HorizontalAlignment="Left"/>
            </StackPanel>
          </ScrollViewer>
        </DockPanel>
      </Border>
    </Grid>

    <!-- history overlay -->
    <Grid x:Name="historyOverlay" Visibility="Collapsed" Background="#A6000000">
      <Border Width="680" Height="540" CornerRadius="16" Background="{DynamicResource TOverlay}" BorderBrush="{DynamicResource TGlassBrd}" BorderThickness="1" VerticalAlignment="Center" HorizontalAlignment="Center" Padding="24,22">
        <DockPanel>
          <Grid DockPanel.Dock="Top" Margin="0,0,0,16">
            <TextBlock x:Name="historyTitle" Text="" Foreground="{DynamicResource TFg}" FontSize="16" FontWeight="SemiBold" VerticalAlignment="Center"/>
            <Button x:Name="clearHistoryBtn" Content="" Style="{StaticResource Ghost}" Height="34" Width="130" HorizontalAlignment="Right"/>
          </Grid>
          <Grid DockPanel.Dock="Top" Margin="0,0,0,12">
            <TextBox x:Name="historySearchBox" Style="{StaticResource GlassInput}" Height="36"/>
            <TextBlock x:Name="historySearchHint" Text="" Foreground="{DynamicResource TFgSub}" FontSize="12.5" Margin="14,0,0,0" VerticalAlignment="Center" IsHitTestVisible="False"/>
          </Grid>
          <Button x:Name="historyCloseBtn" DockPanel.Dock="Bottom" Content="" Style="{StaticResource Primary}" Width="140" HorizontalAlignment="Right" Margin="0,14,0,0"/>
          <ScrollViewer VerticalScrollBarVisibility="Auto">
            <StackPanel x:Name="historyList"/>
          </ScrollViewer>
        </DockPanel>
      </Border>
    </Grid>

    <!-- chapter picker overlay -->
    <Grid x:Name="chaptersOverlay" Visibility="Collapsed" Background="#A6000000">
      <Border Width="620" Height="540" CornerRadius="16" Background="{DynamicResource TOverlay}" BorderBrush="{DynamicResource TGlassBrd}" BorderThickness="1" VerticalAlignment="Center" HorizontalAlignment="Center" Padding="24,22">
        <DockPanel>
          <Grid DockPanel.Dock="Top" Margin="0,0,0,14">
            <TextBlock x:Name="chaptersTitle" Text="" Foreground="{DynamicResource TFg}" FontSize="16" FontWeight="SemiBold" VerticalAlignment="Center"/>
            <StackPanel Orientation="Horizontal" HorizontalAlignment="Right">
              <Button x:Name="chaptersAllBtn" Content="" Style="{StaticResource Ghost}" Height="32" Width="70" Margin="0,0,8,0"/>
              <Button x:Name="chaptersNoneBtn" Content="" Style="{StaticResource Ghost}" Height="32" Width="80"/>
            </StackPanel>
          </Grid>
          <Grid DockPanel.Dock="Bottom" Margin="0,14,0,0">
            <TextBlock x:Name="chaptersHint" Text="" Foreground="{DynamicResource TFgDim}" FontSize="12" VerticalAlignment="Center"/>
            <StackPanel Orientation="Horizontal" HorizontalAlignment="Right">
              <Button x:Name="chaptersCloseBtn" Content="" Style="{StaticResource Ghost}" Width="110" Margin="0,0,10,0"/>
              <Button x:Name="chaptersApplyBtn" Content="" Style="{StaticResource Primary}" Width="140"/>
            </StackPanel>
          </Grid>
          <ScrollViewer VerticalScrollBarVisibility="Auto">
            <StackPanel x:Name="chaptersList"/>
          </ScrollViewer>
        </DockPanel>
      </Border>
    </Grid>
  </Grid>
</Window>
'@

$reader = New-Object System.Xml.XmlNodeReader $xaml
$window = [Windows.Markup.XamlReader]::Load($reader)

# Safety net: do not crash on unhandled UI exceptions
try { $window.Dispatcher.add_UnhandledException({ param($s, $ev) $ev.Handled = $true }) } catch {}

# elements
$urlBox = $window.FindName('urlBox')
$pasteBtn = $window.FindName('pasteBtn')
$titleBar = $window.FindName('titleBar')
$headerLogo = $window.FindName('headerLogo')
$clearBtn = $window.FindName('clearBtn')
$torrentBtn = $window.FindName('torrentBtn')
$qualityPanel = $window.FindName('qualityPanel')
$audioTracksContainer = $window.FindName('audioTracksContainer')
$audioTracksPanel = $window.FindName('audioTracksPanel')
$cookiesPanel = $window.FindName('cookiesPanel')
$playlistToggle = $window.FindName('playlistToggle')
$playlistRangeBox = $window.FindName('playlistRangeBox')
$playlistRangeHint = $window.FindName('playlistRangeHint')
$splitChaptersToggle = $window.FindName('splitChaptersToggle')
$downloadThumbBtn = $window.FindName('downloadThumbBtn')
$folderBox = $window.FindName('folderBox')
$browseBtn = $window.FindName('browseBtn')
$downloadBtn = $window.FindName('downloadBtn')
$cancelBtn = $window.FindName('cancelBtn')
$openBtn = $window.FindName('openBtn')
$updateBtn = $window.FindName('updateBtn')
$statusText = $window.FindName('statusText')
$statusDot = $window.FindName('statusDot')
$itemTitle = $window.FindName('itemTitle')
$detailText = $window.FindName('detailText')
$progress = $window.FindName('progress')
$dotClose = $window.FindName('dotClose')
$dotMin = $window.FindName('dotMin')
$urlHint = $window.FindName('urlHint')
$logBtn = $window.FindName('logBtn')
$queueScroll = $window.FindName('queueScroll')
$queuePanel = $window.FindName('queuePanel')
$clearQueueBtn = $window.FindName('clearQueueBtn')
$rootClip = $window.FindName('rootClip')
$gearBtn = $window.FindName('gearBtn')
$settingsOverlay = $window.FindName('settingsOverlay')
$settingsClose = $window.FindName('settingsClose')
$sponsorblockToggle = $window.FindName('sponsorblockToggle')
$smartTaggerToggle = $window.FindName('smartTaggerToggle')
$historyBtn = $window.FindName('historyBtn')
$historyOverlay = $window.FindName('historyOverlay')
$historyList = $window.FindName('historyList')
$historyCloseBtn = $window.FindName('historyCloseBtn')
$clearHistoryBtn = $window.FindName('clearHistoryBtn')
$presetDownloads = $window.FindName('presetDownloads')
$presetMusic = $window.FindName('presetMusic')
$presetDesktop = $window.FindName('presetDesktop')
$subsToggle = $window.FindName('subsToggle')
$subsLangPanel = $window.FindName('subsLangPanel')
$themePanel = $window.FindName('themePanel')
$cardBorder = $window.FindName('cardBorder')
$opacitySlider = $window.FindName('opacitySlider')
$previewCard = $window.FindName('previewCard')
$previewImg = $window.FindName('previewImg')
$previewTitle = $window.FindName('previewTitle')
$previewClose = $window.FindName('previewClose')
$playerBar = $window.FindName('playerBar')
$btnPlay = $window.FindName('btnPlay')
$playGlyph = $window.FindName('playGlyph')
$btnPrev = $window.FindName('btnPrev')
$btnRew = $window.FindName('btnRew')
$btnFf = $window.FindName('btnFf')
$btnNext = $window.FindName('btnNext')
$curTime = $window.FindName('curTime')
$totalTime = $window.FindName('totalTime')
$artBtn = $window.FindName('artBtn')
$videoOverlay = $window.FindName('videoOverlay')
$videoRect = $window.FindName('videoRect')
$videoClose = $window.FindName('videoClose')
$searchBtn = $window.FindName('searchBtn')
$ytLogoBtn = $window.FindName('ytLogoBtn')
$searchOverlay = $window.FindName('searchOverlay')
$searchBox = $window.FindName('searchBox')
$searchGo = $window.FindName('searchGo')
$searchCloseBtn = $window.FindName('searchCloseBtn')
$searchResults = $window.FindName('searchResults')
$openFileBtn = $window.FindName('openFileBtn')
$gifBtn = $window.FindName('gifBtn')
$previewSize = $window.FindName('previewSize')
$chaptersBtn = $window.FindName('chaptersBtn')
$chaptersOverlay = $window.FindName('chaptersOverlay')
$chaptersList = $window.FindName('chaptersList')
$chaptersAllBtn = $window.FindName('chaptersAllBtn')
$chaptersNoneBtn = $window.FindName('chaptersNoneBtn')
$chaptersCloseBtn = $window.FindName('chaptersCloseBtn')
$chaptersApplyBtn = $window.FindName('chaptersApplyBtn')
$historySearchBox = $window.FindName('historySearchBox')
$historySearchHint = $window.FindName('historySearchHint')
$parallelPanel = $window.FindName('parallelPanel')
$ratePanel = $window.FindName('ratePanel')
$codecPanel = $window.FindName('codecPanel')
$archiveToggle = $window.FindName('archiveToggle')
$clipWatchToggle = $window.FindName('clipWatchToggle')
$trimTrack = $window.FindName('trimTrack')
$trimSel = $window.FindName('trimSel')
$trimH1 = $window.FindName('trimH1')
$trimH2 = $window.FindName('trimH2')
$trimLabel = $window.FindName('trimLabel')
$chaptersHint = $window.FindName('chaptersHint')
foreach ($n in @('lblLinks', 'lblQuality', 'lblAudio', 'lblTrim', 'lblFolder', 'searchTitle', 'settingsTitle', 'lblParallel', 'lblRate', 'lblCodec',
    'lblCookies', 'lblSb', 'lblTagger', 'lblSubs', 'lblTheme', 'lblOpacity', 'langRu', 'langEn', 'historyTitle', 'chaptersTitle')) {
  Set-Variable -Name $n -Value $window.FindName($n)
}
$script:mp = New-Object System.Windows.Media.MediaPlayer
$script:mp.Volume = 1
try {
  $script:vd = New-Object System.Windows.Media.VideoDrawing
  $script:vd.Player = $script:mp
  $script:vd.Rect = New-Object System.Windows.Rect 0, 0, 160, 90
  $vdBrush = New-Object System.Windows.Media.DrawingBrush $script:vd
  $vdBrush.Stretch = 'Uniform'
  $videoRect.Fill = $vdBrush
}
catch {}

# ---- application icon (drawn at runtime when no icon file exists) ----
function New-AppIcon {
  $bmp = New-Object System.Drawing.Bitmap 64, 64
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $rect = New-Object System.Drawing.Rectangle 3, 3, 58, 58
  # neutral monochrome fallback: dark disc, white download arrow (matches the app palette, no hue)
  $disc = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(26, 26, 30))
  $g.FillEllipse($disc, $rect)
  $white = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
  $g.FillRectangle($white, 29, 17, 6, 16)
  $arrow = @((New-Object System.Drawing.Point 22, 31), (New-Object System.Drawing.Point 42, 31), (New-Object System.Drawing.Point 32, 46))
  $g.FillPolygon($white, $arrow)
  $g.FillRectangle($white, 20, 49, 24, 5)
  $g.Dispose()
  return $bmp
}
$script:notify = $null
$script:taskbar = $null
try {
  $iconCustom = $null
  foreach ($n in @('icon.ico', 'ico.ico', 'icon.png', 'mascot.png', 'deviload.png')) { $p = Join-Path $root $n; if (Test-Path $p) { $iconCustom = $p; break } }
  if ($iconCustom) {
    $bi = $null
    if ($iconCustom -like '*.ico') {
      # multi-size .ico: take the largest frame, WPF scales it for the taskbar / Alt-Tab
      try {
        $dec = New-Object System.Windows.Media.Imaging.IconBitmapDecoder ((New-Object System.Uri $iconCustom), 'None', 'OnLoad')
        foreach ($fr in $dec.Frames) { if ($null -eq $bi -or $fr.PixelWidth -gt $bi.PixelWidth) { $bi = $fr } }
      }
      catch { $bi = $null }
    }
    if ($null -eq $bi) {
      $bi = New-Object System.Windows.Media.Imaging.BitmapImage
      $bi.BeginInit(); $bi.CacheOption = 'OnLoad'; $bi.UriSource = New-Object System.Uri $iconCustom; $bi.EndInit()
    }
    $window.Icon = $bi   # taskbar / Alt-Tab icon (the window has no system title bar)
    if ($headerLogo) {
      # title-bar logo: prefer the high-resolution PNG so the 24 px image is crisp, fall back to the .ico frame
      $logoSrc = $bi
      foreach ($n in @('mascot.png', 'icon.png', 'deviload.png')) {
        $p = Join-Path $root $n
        if (Test-Path $p) {
          try {
            $li = New-Object System.Windows.Media.Imaging.BitmapImage
            $li.BeginInit(); $li.CacheOption = 'OnLoad'; $li.DecodePixelWidth = 96; $li.UriSource = New-Object System.Uri $p; $li.EndInit()
            $logoSrc = $li; break
          }
          catch {}
        }
      }
      $headerLogo.Source = $logoSrc
    }
    if ($iconCustom -like '*.ico') { $script:appIcon = New-Object System.Drawing.Icon $iconCustom }
    else { $cb = New-Object System.Drawing.Bitmap $iconCustom; $script:appIcon = [System.Drawing.Icon]::FromHandle($cb.GetHicon()) }
  }
  else {
    $iconBmp = New-AppIcon
    $hbmp = $iconBmp.GetHbitmap()
    $iconSrc = [System.Windows.Interop.Imaging]::CreateBitmapSourceFromHBitmap($hbmp, [IntPtr]::Zero, [System.Windows.Int32Rect]::Empty, [System.Windows.Media.Imaging.BitmapSizeOptions]::FromEmptyOptions())
    $window.Icon = $iconSrc
    if ($headerLogo) { $headerLogo.Source = $iconSrc }
    $script:appIcon = [System.Drawing.Icon]::FromHandle($iconBmp.GetHicon())
  }
  $script:notify = New-Object System.Windows.Forms.NotifyIcon
  $script:notify.Icon = $script:appIcon
  $script:notify.Text = 'Deviload'
  $script:notify.Visible = $false
  $script:notify.add_BalloonTipClosed({ try { $script:notify.Visible = $false } catch {} })
}
catch {}
try {
  $script:taskbar = New-Object System.Windows.Shell.TaskbarItemInfo
  $window.TaskbarItemInfo = $script:taskbar
}
catch {}

function Notify($title, $text) {
  try { [System.Media.SystemSounds]::Asterisk.Play() } catch {}
  if ($script:notify) {
    try { $script:notify.Visible = $true; $script:notify.ShowBalloonTip(4000, $title, $text, [System.Windows.Forms.ToolTipIcon]::Info) } catch {}
  }
}
function Set-TaskProgress($state, $val) {
  if ($script:taskbar) {
    try {
      $script:taskbar.ProgressState = $state
      if ($val -ge 0) { $script:taskbar.ProgressValue = [double]$val }
    }
    catch {}
  }
}
function Set-WinHeight($h) {
  try {
    $maxH = [System.Windows.SystemParameters]::WorkArea.Height - 16
    if ($h -gt $maxH) { $h = [math]::Floor($maxH) }
    $window.Height = $h
    $rootClip.Rect = New-Object System.Windows.Rect 0, 0, 800, $h
  }
  catch {}
}

$script:hwnd = [IntPtr]::Zero
$script:lightTheme = $false
function Apply-Transparency($v) {
  $a = [int](208 - ($v / 100.0) * 144)
  if ($a -lt 48) { $a = 48 }; if ($a -gt 240) { $a = 240 }
  if ($script:lightTheme) { $cr = 0xFA; $cg = 0xFA; $cb = 0xFB } else { $cr = 0x0E; $cg = 0x0E; $cb = 0x11 }
  try {
    $col = [System.Windows.Media.Color]::FromArgb($a, $cr, $cg, $cb)
    $cardBorder.Background = New-Object System.Windows.Media.SolidColorBrush $col
  }
  catch {}
  try {
    if ($script:hwnd -ne [IntPtr]::Zero) {
      $tint = [System.BitConverter]::ToInt32([byte[]]@($cb, $cg, $cr, [byte]$a), 0)
      [Win32.Acrylic]::Apply($script:hwnd, $tint)
    }
  }
  catch {}
}
function Apply-Theme($light) {
  $script:lightTheme = ($light -eq 1)
  if ($script:lightTheme) {
    $pal = @{ TFg = '#1A1A1E'; TFgDim = '#6F6F78'; TFgSub = '#A1A1A8'; TGlass = '#0A000000'; TGlassBrd = '#16000000'; TTrack = '#17000000'; TPanel = '#06000000'; TPanelBrd = '#0F000000'; TOverlay = '#FAFBFBFC'; TBar = '#F2F5F5F7'; TGlyph = '#DD2A2A2E'; TGlyphDim = '#8A62626A'; TAccent = '#1A1A1E'; TAccentFg = '#FAFAFB'; TAccentSoft = '#26000000'; TKnob = '#FFFFFF'; TFocus = '#4D000000' }
  }
  else {
    $pal = @{ TFg = '#F5F5F6'; TFgDim = '#9B9BA4'; TFgSub = '#6B6B74'; TGlass = '#0FFFFFFF'; TGlassBrd = '#1AFFFFFF'; TTrack = '#21FFFFFF'; TPanel = '#0BFFFFFF'; TPanelBrd = '#16FFFFFF'; TOverlay = '#F70E0E11'; TBar = '#F00C0C0F'; TGlyph = '#E7E7EA'; TGlyphDim = '#8F8F97'; TAccent = '#F5F5F6'; TAccentFg = '#131316'; TAccentSoft = '#30FFFFFF'; TKnob = '#F0F0F2'; TFocus = '#59FFFFFF' }
  }
  foreach ($k in $pal.Keys) { try { $window.Resources[$k] = $brushConv.ConvertFromString($pal[$k]) } catch {} }
  Apply-Transparency $opacitySlider.Value
}

function Format-Bytes($b) {
  $b = [double]$b
  if ($b -ge 1GB) { return ('{0:0.0} ' -f ($b / 1GB)) + (T 'unit_gb') }
  if ($b -ge 1MB) { return ('{0:0} ' -f ($b / 1MB)) + (T 'unit_mb') }
  if ($b -gt 0) { return ('{0:0} ' -f ($b / 1KB)) + (T 'unit_kb') }
  return ''
}
function Format-Time($sec) {
  $sec = [int][math]::Round([double]$sec)
  if ($sec -lt 0) { $sec = 0 }
  $ts = [TimeSpan]::FromSeconds($sec)
  if ($ts.TotalHours -ge 1) { return ('{0}:{1:d2}:{2:d2}' -f [int]$ts.TotalHours, $ts.Minutes, $ts.Seconds) }
  return ('{0}:{1:d2}' -f [int]$ts.TotalMinutes, $ts.Seconds)
}
function Parse-Time($s) {
  # "SS" / "M:SS" / "H:MM:SS" -> seconds
  if (-not $s) { return 0.0 }
  [double]$sec = 0
  foreach ($p in ("$s".Trim() -split ':')) { if ($p -ne '') { $sec = $sec * 60 + [double]$p } }
  return $sec
}
function Get-YtId($u) {
  if (-not $u) { return '' }
  if ($u -notmatch 'youtu') { return '' }
  if ($u -match '[?&]v=([\w-]{11})') { return $matches[1] }
  if ($u -match 'youtu\.be/([\w-]{11})') { return $matches[1] }
  if ($u -match 'youtube\.com/(?:embed|shorts|live)/([\w-]{11})') { return $matches[1] }
  return ''
}
function Update-TrimFromTrack {
  $a = [System.Windows.Controls.Canvas]::GetLeft($trimH1)
  $b = [System.Windows.Controls.Canvas]::GetLeft($trimH2)
  if ([double]::IsNaN($a)) { $a = 0 }
  if ([double]::IsNaN($b)) { $b = 688 }
  [System.Windows.Controls.Canvas]::SetLeft($trimSel, $a + 6)
  $trimSel.Width = [math]::Max(0, $b - $a)
  if ($script:vidDur -le 0) { $script:trimS = ''; $script:trimE = ''; $trimLabel.Text = T 'trim_all_after'; return }
  $fa = $a / 688.0
  $fb = $b / 688.0
  $script:trimS = $(if ($fa -le 0.006) { '' } else { Format-Time ($fa * $script:vidDur) })
  $script:trimE = $(if ($fb -ge 0.994) { '' } else { Format-Time ($fb * $script:vidDur) })
  if (-not $script:trimS -and -not $script:trimE) {
    $trimLabel.Text = T 'trim_all'
  }
  else {
    $sl = $(if ($script:trimS) { $script:trimS } else { T 'trim_start' })
    $el = $(if ($script:trimE) { $script:trimE } else { T 'trim_end' })
    $trimLabel.Text = (T 'trim_range') -f $sl, $el
  }
  if (@($script:selectedChapters).Count -gt 0) {
    $trimLabel.Text = (T 'trim_chapters') -f @($script:selectedChapters).Count
  }
}
function Set-Chapters($chaps, $dur) {
  foreach ($t in $script:chapterTicks) { try { $trimTrack.Children.Remove($t) } catch {} }
  $script:chapterTicks = @()
  $script:chapters = @()
  $script:chapterData = @()
  if (-not $chaps -or $dur -le 0) { return }
  foreach ($c in $chaps) {
    if ($null -eq $c.start_time) { continue }
    $st = [double]$c.start_time
    $script:chapters += $st
    $ce = $(if ($null -ne $c.end_time) { [double]$c.end_time } else { $dur })
    $ct = $(if ($c.title) { [string]$c.title } else { Format-Time $st })
    $script:chapterData += , ([PSCustomObject]@{ Title = $ct; Start = $st; End = $ce })
    if ($st -le 0 -or $st -ge $dur) { continue }
    $x = ($st / $dur) * 688
    $tick = New-Object System.Windows.Shapes.Rectangle
    $tick.Width = 2; $tick.Height = 16
    $tick.Fill = $window.FindResource('TFgDim')
    [System.Windows.Controls.Canvas]::SetLeft($tick, $x + 6)
    [System.Windows.Controls.Canvas]::SetTop($tick, 7)
    [void]$trimTrack.Children.Add($tick)
    $script:chapterTicks += $tick
  }
}

function Add-SearchRow($r) {
  $url = "https://www.youtube.com/watch?v=$($r.id)"
  $row = New-Object System.Windows.Controls.Border
  $row.CornerRadius = New-Object System.Windows.CornerRadius 8
  $row.Background = $window.FindResource('TGlass')
  $row.Padding = New-Object System.Windows.Thickness 12, 9, 12, 9
  $row.Margin = New-Object System.Windows.Thickness 0, 0, 0, 6
  $row.Cursor = [System.Windows.Input.Cursors]::Hand
  $sp = New-Object System.Windows.Controls.StackPanel
  $t = New-Object System.Windows.Controls.TextBlock
  $t.Text = [string]$r.title; $t.Foreground = $window.FindResource('TFg'); $t.FontSize = 13
  $t.TextTrimming = 'CharacterEllipsis'; $t.TextWrapping = 'NoWrap'
  $meta = New-Object System.Windows.Controls.TextBlock
  $dur = $(if ($r.duration) { ' · ' + (Format-Time ([double]$r.duration)) } else { '' })
  $ch = $(if ($r.uploader) { [string]$r.uploader } elseif ($r.channel) { [string]$r.channel } else { '' })
  $meta.Text = ($ch + $dur); $meta.Foreground = $window.FindResource('TFgDim'); $meta.FontSize = 11
  $meta.Margin = New-Object System.Windows.Thickness 0, 3, 0, 0
  [void]$sp.Children.Add($t); [void]$sp.Children.Add($meta)
  $row.Child = $sp
  $row.Tag = $url
  $row.Add_MouseLeftButtonDown({
      param($s, $e)
      $e.Handled = $true
      $urlBox.Text = $s.Tag
      $searchOverlay.Visibility = 'Collapsed'
      Fetch-Preview
    })
  [void]$searchResults.Children.Add($row)
}

function Run-Search {
  $q = $searchBox.Text.Trim()
  if (-not $q) { return }
  if ($script:searchProc -and -not $script:searchProc.HasExited) {
    Kill-Tree $script:searchProc.Id
    $script:searchProc = $null
  }
  $searchResults.Children.Clear()
  $loading = New-Object System.Windows.Controls.TextBlock
  $loading.Text = T 'st_searching'; $loading.Foreground = $window.FindResource('TFgDim')
  $loading.Margin = New-Object System.Windows.Thickness 4, 8, 0, 0
  [void]$searchResults.Children.Add($loading)
  Remove-Item $searchJson, ($searchJson + '.err') -ErrorAction SilentlyContinue
  $cIdx = Get-Sel $cookiesPanel
  $cookiesArg = ''
  if ($cIdx -eq 1) { $cf = Join-Path $root 'cookies.txt'; if (Test-Path $cf) { $cookiesArg = "--cookies `"$cf`"" } }
  elseif ($cIdx -ge 2) { $cookiesArg = "--cookies-from-browser $($cBrowsers[$cIdx])" }
  $argStr = "`"ytsearch15:$q`" --flat-playlist --dump-json --no-warnings $cookiesArg"
  try { $script:searchProc = Start-Hidden $ytdlp $argStr $searchJson ($searchJson + '.err') }
  catch { $searchResults.Children.Clear(); $loading.Text = T 'err_search_start' }
}
$pillStyle = $window.FindResource('Pill')
$brushConv = New-Object System.Windows.Media.BrushConverter

for ($i = 0; $i -lt $qOpts.Count; $i++) {
  $rb = New-Object System.Windows.Controls.RadioButton
  $rb.Content = $qOpts[$i]; $rb.GroupName = 'quality'; $rb.Style = $pillStyle; $rb.Tag = $i
  if ($i -eq 0) { $rb.IsChecked = $true }
  [void]$qualityPanel.Children.Add($rb)
}
for ($i = 0; $i -lt $cOpts.Count; $i++) {
  $rb = New-Object System.Windows.Controls.RadioButton
  $rb.Content = $cOpts[$i]; $rb.GroupName = 'cookies'; $rb.Style = $pillStyle; $rb.Tag = $i
  if ($i -eq 0) { $rb.IsChecked = $true }
  [void]$cookiesPanel.Children.Add($rb)
}
for ($i = 0; $i -lt $sOpts.Count; $i++) {
  $rb = New-Object System.Windows.Controls.RadioButton
  $rb.Content = $sOpts[$i]; $rb.GroupName = 'subs'; $rb.Style = $pillStyle; $rb.Tag = $i
  if ($i -eq 0) { $rb.IsChecked = $true }
  [void]$subsLangPanel.Children.Add($rb)
}
for ($i = 0; $i -lt $tOpts.Count; $i++) {
  $rb = New-Object System.Windows.Controls.RadioButton
  $rb.Content = $tOpts[$i]; $rb.GroupName = 'theme'; $rb.Style = $pillStyle; $rb.Tag = $i
  if ($i -eq 0) { $rb.IsChecked = $true }
  $rb.Add_Click({ param($s, $e) Apply-Theme ([int]$s.Tag) })
  [void]$themePanel.Children.Add($rb)
}
for ($i = 0; $i -lt $parOpts.Count; $i++) {
  $rb = New-Object System.Windows.Controls.RadioButton
  $rb.Content = $parOpts[$i]; $rb.GroupName = 'parallel'; $rb.Style = $pillStyle; $rb.Tag = $i
  if ($i -eq 0) { $rb.IsChecked = $true }
  [void]$parallelPanel.Children.Add($rb)
}
for ($i = 0; $i -lt $rateOpts.Count; $i++) {
  $rb = New-Object System.Windows.Controls.RadioButton
  $rb.Content = $rateOpts[$i]; $rb.GroupName = 'rate'; $rb.Style = $pillStyle; $rb.Tag = $i
  if ($i -eq 0) { $rb.IsChecked = $true }
  [void]$ratePanel.Children.Add($rb)
}
for ($i = 0; $i -lt $codecOpts.Count; $i++) {
  $rb = New-Object System.Windows.Controls.RadioButton
  $rb.Content = $codecOpts[$i]; $rb.GroupName = 'codec'; $rb.Style = $pillStyle; $rb.Tag = $i
  if ($i -eq 0) { $rb.IsChecked = $true }
  [void]$codecPanel.Children.Add($rb)
}
$folderBox.Text = $defaultFolder

function Get-Sel($panel) {
  foreach ($c in $panel.Children) { if ($c.IsChecked -eq $true) { return [int]$c.Tag } }
  return 0
}
function Set-Sel($panel, $idx) {
  foreach ($c in $panel.Children) { if ([int]$c.Tag -eq $idx) { $c.IsChecked = $true } }
}

$historyFile = Join-Path $root 'history.json'
function Add-HistoryItem($title, $url, $path) {
  try {
    $items = @()
    if (Test-Path $historyFile) {
      $items = @(Get-Content $historyFile -Raw -Encoding UTF8 | ConvertFrom-Json)
    }
    $ytid = Get-YtId $url
    $newItem = [PSCustomObject]@{
      title = $title
      url   = $url
      path  = $path
      time  = (Get-Date).ToString('dd.MM.yyyy HH:mm')
      thumb = $(if ($ytid) { "https://i.ytimg.com/vi/$ytid/mqdefault.jpg" } else { '' })
    }
    $items = @($newItem) + @($items | Select-Object -First 99)
    $items | ConvertTo-Json -Depth 5 | Set-Content -Path $historyFile -Encoding UTF8
  }
  catch {}
}

function Render-History($filter) {
  $historyList.Children.Clear()
  $items = @()
  if (Test-Path $historyFile) {
    try { $items = @(Get-Content $historyFile -Raw -Encoding UTF8 | ConvertFrom-Json) } catch { $items = @() }
  }
  if ($filter) {
    $rx = [regex]::Escape([string]$filter)
    $items = @($items | Where-Object { "$($_.title)" -match $rx -or "$($_.path)" -match $rx })
  }
  if ($items.Count -eq 0) {
    $tb = New-Object System.Windows.Controls.TextBlock
    $tb.Text = $(if ($filter) { T 'none_found' } else { T 'hist_empty' })
    $tb.Foreground = $window.FindResource('TFgDim'); $tb.Margin = New-Object System.Windows.Thickness 8, 12, 0, 0
    [void]$historyList.Children.Add($tb)
    return
  }
  try {
    foreach ($it in $items) {
      $card = New-Object System.Windows.Controls.Border
      $card.Background = $window.FindResource('TGlass')
      $card.BorderBrush = $window.FindResource('TGlassBrd')
      $card.BorderThickness = New-Object System.Windows.Thickness 1
      $card.CornerRadius = New-Object System.Windows.CornerRadius 10
      $card.Margin = New-Object System.Windows.Thickness 0, 0, 0, 8
      $card.Padding = New-Object System.Windows.Thickness 10, 8, 10, 8

      $g = New-Object System.Windows.Controls.Grid
      $c0 = New-Object System.Windows.Controls.ColumnDefinition; $c0.Width = [System.Windows.GridLength]::Auto
      $c1 = New-Object System.Windows.Controls.ColumnDefinition; $c1.Width = New-Object System.Windows.GridLength 1, [System.Windows.GridUnitType]::Star
      $c2 = New-Object System.Windows.Controls.ColumnDefinition; $c2.Width = [System.Windows.GridLength]::Auto
      $g.ColumnDefinitions.Add($c0); $g.ColumnDefinitions.Add($c1); $g.ColumnDefinitions.Add($c2)

      # thumbnail
      $tbrd = New-Object System.Windows.Controls.Border
      $tbrd.Width = 64; $tbrd.Height = 36
      $tbrd.CornerRadius = New-Object System.Windows.CornerRadius 6
      $tbrd.ClipToBounds = $true
      $tbrd.Background = $window.FindResource('TTrack')
      $tbrd.VerticalAlignment = 'Center'
      $tbrd.Margin = New-Object System.Windows.Thickness 0, 0, 12, 0
      if ($it.thumb) {
        try {
          $bi = New-Object System.Windows.Media.Imaging.BitmapImage
          $bi.BeginInit(); $bi.UriSource = New-Object System.Uri ([string]$it.thumb); $bi.EndInit()
          $img = New-Object System.Windows.Controls.Image
          $img.Source = $bi; $img.Stretch = 'UniformToFill'
          $tbrd.Child = $img
        }
        catch {}
      }
      else {
        $ph = New-Object System.Windows.Controls.TextBlock
        $ph.Text = [char]0xE714; $ph.FontFamily = New-Object System.Windows.Media.FontFamily 'Segoe MDL2 Assets'
        $ph.FontSize = 14; $ph.Foreground = $window.FindResource('TFgSub')
        $ph.HorizontalAlignment = 'Center'; $ph.VerticalAlignment = 'Center'
        $tbrd.Child = $ph
      }
      [System.Windows.Controls.Grid]::SetColumn($tbrd, 0)
      [void]$g.Children.Add($tbrd)

      $info = New-Object System.Windows.Controls.StackPanel
      $info.VerticalAlignment = 'Center'
      $t = New-Object System.Windows.Controls.TextBlock; $t.Text = $it.title; $t.FontWeight = 'SemiBold'; $t.Foreground = $window.FindResource('TFg'); $t.FontSize = 13; $t.TextTrimming = 'CharacterEllipsis'
      $tm = New-Object System.Windows.Controls.TextBlock; $tm.Text = "$($it.time)  ·  $($it.path)"; $tm.Foreground = $window.FindResource('TFgDim'); $tm.FontSize = 11; $tm.Margin = New-Object System.Windows.Thickness 0, 4, 0, 0; $tm.TextTrimming = 'CharacterEllipsis'
      [void]$info.Children.Add($t); [void]$info.Children.Add($tm)
      [System.Windows.Controls.Grid]::SetColumn($info, 1)
      [void]$g.Children.Add($info)

      $btns = New-Object System.Windows.Controls.StackPanel; $btns.Orientation = 'Horizontal'; $btns.VerticalAlignment = 'Center'; $btns.Margin = New-Object System.Windows.Thickness 12, 0, 0, 0
      if ($it.url -and "$($it.url)" -match '^(https?://|magnet:)') {
        $bAgain = New-Object System.Windows.Controls.Button; $bAgain.Content = T 'btn_again'; $bAgain.Style = $window.FindResource('Ghost'); $bAgain.Height = 28; $bAgain.Padding = New-Object System.Windows.Thickness 10, 0, 10, 0; $bAgain.Margin = New-Object System.Windows.Thickness 0, 0, 8, 0
        $bAgain.Tag = [string]$it.url
        $bAgain.Add_Click({
            param($s, $e)
            $historyOverlay.Visibility = 'Collapsed'
            $urlBox.Text = [string]$s.Tag
            Start-Download
          })
        [void]$btns.Children.Add($bAgain)
      }
      $bPlay = New-Object System.Windows.Controls.Button; $bPlay.Content = T 'btn_open'; $bPlay.Style = $window.FindResource('Ghost'); $bPlay.Height = 28; $bPlay.Padding = New-Object System.Windows.Thickness 10, 0, 10, 0
      $bPlay.Tag = [string]$it.path
      $bPlay.Add_Click({
          param($s, $e)
          $fp = [string]$s.Tag
          if ($fp -and (Test-Path $fp)) { Start-Process explorer.exe "/select,`"$fp`"" }
          elseif ($fp) {
            $dir = Split-Path $fp -Parent
            if ($dir -and (Test-Path $dir)) { Start-Process explorer.exe $dir }
          }
        })
      [void]$btns.Children.Add($bPlay)
      [System.Windows.Controls.Grid]::SetColumn($btns, 2)
      [void]$g.Children.Add($btns)

      $card.Child = $g
      [void]$historyList.Children.Add($card)
    }
  }
  catch {}
}

# ---------------- language switching ----------------
$script:readyText = ''
# Top-bar "RU | EN" toggle: Tag="on" switches the LangBtn style trigger to the accent colour
# (DynamicResource inside the trigger, so a theme change recolours it too).
function Update-LangSwitch {
  $langRu.Tag = $(if ($script:lang -eq 'ru') { 'on' } else { 'off' })
  $langEn.Tag = $(if ($script:lang -eq 'en') { 'on' } else { 'off' })
}
function Set-Language($code) {
  if ($code -ne 'ru' -and $code -ne 'en') { return }
  $script:lang = $code
  Apply-Language
  Save-Settings
}
function Set-PillLabels($panel, $labels) {
  foreach ($c in $panel.Children) { $i = [int]$c.Tag; if ($i -lt $labels.Count) { $c.Content = $labels[$i] } }
}
function Get-AudioLabel($code) {
  switch ($code) {
    'default' { return (T 'audio_original') }
    'ru' { return (T 'audio_ru') }
    'en' { return '🇺🇸 English' }
    'es' { return '🇪🇸 Español' }
    'de' { return '🇩🇪 Deutsch' }
    'fr' { return '🇫🇷 Français' }
    'all' { return (T 'audio_all') }
    default { return ([string]$code).ToUpper() }
  }
}
# Re-applies every user-visible string in the current language (callable at runtime, no restart needed)
function Apply-Language {
  $wasReady = (-not $statusText.Text) -or ($statusText.Text -eq $script:readyText)
  # title bar
  $ytLogoBtn.ToolTip = T 'tip_ytsearch'; $historyBtn.ToolTip = T 'tip_history'; $searchBtn.ToolTip = T 'tip_search'
  $gearBtn.ToolTip = T 'tip_settings'; $dotMin.ToolTip = T 'tip_min'; $dotClose.ToolTip = T 'tip_close'
  # main form
  $lblLinks.Text = T 'lbl_links'; $urlHint.Text = T 'hint_url'
  $pasteBtn.Content = T 'btn_paste'; $clearBtn.Content = T 'btn_clear'; $torrentBtn.Content = T 'btn_torrent'
  $lblQuality.Text = T 'lbl_quality'; $lblAudio.Text = T 'lbl_audio'; $lblTrim.Text = T 'lbl_trim'
  $gifBtn.Content = T 'btn_gif'
  $playlistToggle.Content = T 'tg_playlist'; $playlistRangeHint.Text = T 'hint_range'
  $splitChaptersToggle.Content = T 'tg_split'; $splitChaptersToggle.ToolTip = T 'tip_split'
  $lblFolder.Text = T 'lbl_folder'
  $presetDownloads.Text = T 'preset_dl'; $presetDownloads.ToolTip = T 'tip_preset_dl'
  $presetMusic.Text = T 'preset_music'; $presetMusic.ToolTip = T 'tip_preset_music'
  $presetDesktop.Text = T 'preset_desktop'; $presetDesktop.ToolTip = T 'tip_preset_desktop'
  $browseBtn.Content = T 'btn_browse'; $downloadBtn.Content = T 'btn_download'; $cancelBtn.Content = T 'btn_cancel'
  $logBtn.Content = T 'btn_log'; $openBtn.Content = T 'btn_folder'; $updateBtn.Content = T 'btn_update'
  $clearQueueBtn.Text = T 'btn_clear_queue'; $openFileBtn.Content = T 'btn_open_file'
  # preview card
  $artBtn.ToolTip = T 'tip_watch'; $downloadThumbBtn.ToolTip = T 'tip_thumb'
  # search overlay
  $searchTitle.Text = T 'ttl_search'; $searchGo.Content = T 'btn_find'; $searchCloseBtn.Content = T 'btn_close'
  # settings overlay
  $settingsTitle.Text = T 'ttl_settings'; $settingsClose.Content = T 'btn_done'
  $lblParallel.Text = T 'set_parallel'; $lblRate.Text = T 'set_rate'; $lblCodec.Text = T 'set_codec'
  $archiveToggle.Content = T 'set_archive'; $clipWatchToggle.Content = T 'set_clip'
  $lblCookies.Text = T 'set_cookies'; $lblSb.Text = T 'set_sb'; $sponsorblockToggle.Content = T 'set_sb_tg'
  $lblTagger.Text = T 'set_tagger'; $smartTaggerToggle.Content = T 'set_tagger_tg'
  $lblSubs.Text = T 'set_subs'; $subsToggle.Content = T 'set_subs_tg'
  $lblTheme.Text = T 'set_theme'; $lblOpacity.Text = T 'set_opacity'
  # top-bar language toggle
  $langRu.ToolTip = T 'lang_ru'; $langEn.ToolTip = T 'lang_en'
  Update-LangSwitch
  # history overlay
  $historyTitle.Text = T 'ttl_history'; $clearHistoryBtn.Content = T 'btn_clear_all'
  $historySearchHint.Text = T 'hint_hist_search'; $historyCloseBtn.Content = T 'btn_close'
  # chapters overlay
  $chaptersTitle.Text = T 'ttl_chapters'; $chaptersAllBtn.Content = T 'btn_all'; $chaptersNoneBtn.Content = T 'btn_none'
  $chaptersHint.Text = T 'hint_chapters'; $chaptersCloseBtn.Content = T 'btn_close'; $chaptersApplyBtn.Content = T 'btn_apply'
  # option pills
  Set-PillLabels $qualityPanel (Get-QOpts)
  Set-PillLabels $cookiesPanel (Get-COpts)
  Set-PillLabels $subsLangPanel (Get-SOpts)
  Set-PillLabels $themePanel (Get-TOpts)
  Set-PillLabels $ratePanel (Get-RateOpts)
  Set-PillLabels $codecPanel (Get-CodecOpts)
  foreach ($c in $audioTracksPanel.Children) { try { $c.Content = Get-AudioLabel ([string]$c.Tag) } catch {} }
  # status line
  $script:readyText = T 'st_ready'
  if ($wasReady) { $statusText.Text = $script:readyText }
  # dynamic labels
  if (@($script:chapterData).Count -gt 1) { Update-ChaptersBtn }
  else { $chaptersBtn.Content = T 'btn_chapters'; Update-TrimFromTrack }
  foreach ($it in $script:queueItems.ToArray()) { if ($it.Status -ne 'now') { Set-ItemStatus $it $it.Status } }
  if ($historyOverlay.Visibility -eq 'Visible') { Render-History $historySearchBox.Text.Trim() }
  # tray menu
  if ($script:miOpen) { try { $script:miOpen.Text = T 'tray_open'; $script:miExit.Text = T 'tray_exit' } catch {} }
  # secondary windows
  if ($script:vidWin) { try { $script:vidWin.Title = T 'ttl_video'; $script:vfull.ToolTip = T 'tip_fullscreen' } catch {} }
  if ($script:wvWin) { try { $script:wvWin.Title = T 'ttl_video' } catch {} }
}
# Buttons (not TextBlocks): Click also fires from keyboard and UI Automation, and it does not start the title-bar drag
$langRu.Add_Click({ Set-Language 'ru' })
$langEn.Add_Click({ Set-Language 'en' })

if ($saved) {
  if ($saved.folder -and (Test-Path $saved.folder)) { $folderBox.Text = $saved.folder }
  if ($null -ne $saved.quality) { Set-Sel $qualityPanel ([int]$saved.quality) }
  if ($null -ne $saved.cookies) { Set-Sel $cookiesPanel ([int]$saved.cookies) }
  if ($saved.playlist) { $playlistToggle.IsChecked = $true }
  if ($saved.playlistRange) { $playlistRangeBox.Text = $saved.playlistRange }
  if ($saved.splitChapters) { $splitChaptersToggle.IsChecked = $true }
  if ($saved.sponsorblock) { $sponsorblockToggle.IsChecked = $true }
  if ($null -ne $saved.smartTagger) { $smartTaggerToggle.IsChecked = [bool]$saved.smartTagger }
  if ($saved.subsOn) { $subsToggle.IsChecked = $true }
  if ($null -ne $saved.subsLang) { Set-Sel $subsLangPanel ([int]$saved.subsLang) }
  if ($null -ne $saved.opacity) { try { $opacitySlider.Value = [double]$saved.opacity } catch {} }
  if ($null -ne $saved.theme) { Set-Sel $themePanel ([int]$saved.theme) }
  if ($null -ne $saved.parallel) { Set-Sel $parallelPanel ([int]$saved.parallel) }
  if ($null -ne $saved.rate) { Set-Sel $ratePanel ([int]$saved.rate) }
  if ($null -ne $saved.codec) { Set-Sel $codecPanel ([int]$saved.codec) }
  if ($saved.archive) { $archiveToggle.IsChecked = $true }
  if ($null -ne $saved.clipWatch) { $clipWatchToggle.IsChecked = [bool]$saved.clipWatch }
}
if ($playlistToggle.IsChecked) {
  $playlistRangeBox.Visibility = 'Visible'
  if (-not $playlistRangeBox.Text) { $playlistRangeHint.Visibility = 'Visible' }
}
Apply-Theme (Get-Sel $themePanel)

function Save-Settings {
  @{
    folder        = $folderBox.Text
    quality       = Get-Sel $qualityPanel
    cookies       = Get-Sel $cookiesPanel
    playlist      = [bool]$playlistToggle.IsChecked
    playlistRange = $playlistRangeBox.Text
    splitChapters = [bool]$splitChaptersToggle.IsChecked
    sponsorblock  = [bool]$sponsorblockToggle.IsChecked
    smartTagger   = [bool]$smartTaggerToggle.IsChecked
    subsOn        = [bool]$subsToggle.IsChecked
    subsLang      = Get-Sel $subsLangPanel
    opacity       = $opacitySlider.Value
    theme         = Get-Sel $themePanel
    parallel      = Get-Sel $parallelPanel
    rate          = Get-Sel $ratePanel
    codec         = Get-Sel $codecPanel
    archive       = [bool]$archiveToggle.IsChecked
    clipWatch     = [bool]$clipWatchToggle.IsChecked
    lang          = $script:lang
  } | ConvertTo-Json | Set-Content -Path $settingsPath -Encoding UTF8
}

# ---------------- state ----------------
$script:proc = $null
$script:previewProc = $null
$script:lastFile = ''
$script:streamUrl = ''
$script:playerSrc = ''
$script:playing = $false
$script:vidWin = $null
$script:vidme = $null
$script:vidPlaying = $false
$script:wvWin = $null
$script:wv = $null
$script:playerDur = 0.0
$script:repeat = $false
$script:liked = $false
$script:shuffleOn = $false
$script:lastPreviewUrl = ''
$script:vidDur = 0.0
$script:trimS = ''
$script:trimE = ''
$script:gifProc = $null
$script:gifOut = ''
$script:chapters = @()
$script:chapterTicks = @()
$script:searchProc = $null
$script:cancelled = $false
$script:sawSuccess = $false
$script:cookieStale = $false
$script:cookieBrowserFail = $false
$script:phase = 'idle'
$script:outPos = 0
$script:errPos = 0
# skip stale output left in %TEMP% by a previous (killed) session, otherwise the status line replays it at startup
try { if (Test-Path $outLog) { $script:outPos = (Get-Item $outLog).Length } } catch {}
try { if (Test-Path $errLog) { $script:errPos = (Get-Item $errLog).Length } } catch {}
$script:logBuffer = New-Object System.Text.StringBuilder
$script:singleOp = ''

# download queue (pool of parallel workers)
$script:queueItems = New-Object System.Collections.Generic.List[object]
$script:workers = New-Object System.Collections.Generic.List[object]
$script:queueTotal = 0
$script:queueOk = 0
$script:queueFail = 0
$script:queueActive = $false
$script:workerSeq = 0
$script:lastAggPct = -1.0
$script:dlFolder = $defaultFolder
$script:hBase = 770
$script:hQueue = 870
$script:selectedChapters = @()
$script:chapterData = @()
Apply-Language

function Set-State($text, $dotHex) {
  $statusText.Text = $text
  try { $statusDot.Fill = $brushConv.ConvertFromString($dotHex) } catch {}
}

function Set-Progress($v) {
  $anim = New-Object System.Windows.Media.Animation.DoubleAnimation
  $anim.To = [double]$v
  $anim.Duration = New-Object System.Windows.Duration ([TimeSpan]::FromMilliseconds(250))
  $ease = New-Object System.Windows.Media.Animation.CubicEase
  $ease.EasingMode = 'EaseOut'
  $anim.EasingFunction = $ease
  $progress.BeginAnimation([System.Windows.Controls.Primitives.RangeBase]::ValueProperty, $anim)
}
function Reset-Progress {
  $progress.BeginAnimation([System.Windows.Controls.Primitives.RangeBase]::ValueProperty, $null)
  $progress.Value = 0
}

function Set-Busy($busy) {
  $downloadBtn.IsEnabled = -not $busy
  $updateBtn.IsEnabled = -not $busy
  $cancelBtn.IsEnabled = $busy
}

function Read-NewText($path, [ref]$pos) {
  if (-not (Test-Path $path)) { return '' }
  try {
    $fs = [System.IO.File]::Open($path, 'Open', 'Read', 'ReadWrite')
    try {
      if ($fs.Length -le $pos.Value) { return '' }
      [void]$fs.Seek($pos.Value, 'Begin')
      $buf = New-Object byte[] ($fs.Length - $pos.Value)
      $n = $fs.Read($buf, 0, $buf.Length)
      $pos.Value += $n
      $utf8 = [System.Text.UTF8Encoding]::new($false, $false)
      $res = $utf8.GetString($buf, 0, $n)
      if ($res -match '\uFFFD') {
        try {
          $cp866 = [System.Text.Encoding]::GetEncoding(866)
          $fallback = $cp866.GetString($buf, 0, $n)
          if ($fallback -notmatch '\uFFFD') { $res = $fallback }
        }
        catch {}
      }
      return $res
    }
    finally { $fs.Close() }
  }
  catch { return '' }
}

function Process-Output($text) {
  if (-not $text) { return }
  [void]$script:logBuffer.Append($text)

  if ($text -match 'no longer valid') { $script:cookieStale = $true }

  $dm = [regex]::Match($text, 'Destination:\s*(.+)')
  if ($dm.Success) {
    $fn = Split-Path ($dm.Groups[1].Value.Trim()) -Leaf
    $fn = $fn -replace '\.f\d+\.[A-Za-z0-9]+$', '' -replace '\.[A-Za-z0-9]+$', ''
    $fn = $fn.Trim()
    if ($fn -notmatch '[\p{L}\p{N}]') { $fn = T 'fb_video' }   # name made of symbols only -> placeholder
    $itemTitle.Text = $fn
    $itemTitle.Visibility = 'Visible'
    if ($script:phase -ne 'merge') { $script:phase = 'download'; Set-State (T 'st_downloading') '#8F8F97' }
  }

  if ($text -match '\[ExtractAudio\]|Extracting audio') {
    $script:phase = 'audio'; Set-State (T 'st_convert_mp3') '#8F8F97'; Set-Progress 100
  }
  if ($text -match 'Merging formats') {
    $script:phase = 'merge'; Set-State (T 'st_merging') '#8F8F97'; Set-Progress 100
    $detailText.Text = ''
  }
  if ($text -match 'Deleting original file|has already been downloaded|\[download\]\s+100% of') {
    $script:sawSuccess = $true
  }

  # final file path
  $fm = [regex]::Match($text, '\[Merger\] Merging formats into "(.+?)"')
  if ($fm.Success) { $script:lastFile = $fm.Groups[1].Value.Trim() }
  $am = [regex]::Match($text, '\[ExtractAudio\] Destination: (.+)')
  if ($am.Success) { $script:lastFile = $am.Groups[1].Value.Trim() }
  $hm = [regex]::Match($text, '\[download\] (.+?) has already been downloaded')
  if ($hm.Success) { $script:lastFile = $hm.Groups[1].Value.Trim() }
  $d2 = [regex]::Match($text, '\[download\] Destination: (.+)')
  if ($d2.Success) {
    $cand = $d2.Groups[1].Value.Trim()
    if ($cand -notmatch '\.f\d+\.[A-Za-z0-9]+$') { $script:lastFile = $cand }
  }

  $pm = [regex]::Matches($text, '\[download\]\s+([\d.]+)% of\s+~?\s*([\d.]+[KMGT]i?B)(?:\s+at\s+([\d.]+[KMGT]?i?B/s))?(?:\s+ETA\s+([\d:]+))?')
  if ($pm.Count -gt 0) {
    $m = $pm[$pm.Count - 1]
    $pct = [double]$m.Groups[1].Value
    if ($script:phase -eq 'idle' -or $script:phase -eq 'start') { $script:phase = 'download'; Set-State (T 'st_downloading') '#8F8F97' }
    if ($script:phase -eq 'download') {
      Set-Progress $pct
      $parts = @(('{0:0}%' -f $pct))
      if ($m.Groups[2].Success) { $parts += $m.Groups[2].Value }
      if ($m.Groups[3].Success) { $parts += $m.Groups[3].Value }
      if ($m.Groups[4].Success) { $parts += "ETA $($m.Groups[4].Value)" }
      $detailText.Text = ($parts -join '   ·   ')
      $detailText.Visibility = 'Visible'
    }
  }
}

function Start-Hidden($exe, $argStr, $outFile, $errFile) {
  # Direct launch without cmd.exe — URLs with & and special characters survive intact
  if ($exe -match 'yt-dlp(\.exe)?$' -and $argStr -notmatch '--encoding') {
    $argStr = "--encoding utf-8 $argStr"
  }
  return [Win32.ProcessRunner]::StartHidden($exe, $argStr, $outFile, $errFile, $root)
}

function Kill-Tree($procId, [switch]$Wait) {
  # Kill the process and its children (yt-dlp + ffmpeg) without a flashing console window
  try {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = 'taskkill.exe'
    $psi.Arguments = "/PID $procId /T /F"
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.WindowStyle = 'Hidden'
    $tk = [System.Diagnostics.Process]::Start($psi)
    if ($Wait) { $tk.WaitForExit() }
  }
  catch {}
}

function Start-YtDlp($argStr, $statusStr, $op = 'op') {
  Remove-Item $outLog, $errLog -ErrorAction SilentlyContinue
  $script:outPos = 0; $script:errPos = 0
  $script:sawSuccess = $false; $script:cookieStale = $false; $script:cancelled = $false
  $script:lastFile = ''
  $script:phase = 'start'
  $script:singleOp = $op
  $openFileBtn.Visibility = 'Collapsed'
  try { $script:mp.Stop() } catch {}
  $script:playing = $false
  $script:playerSrc = ''
  $playGlyph.Text = [char]0xE768; $playerBar.Value = 0; $curTime.Text = '0:00'
  $previewCard.Visibility = 'Collapsed'
  [void]$script:logBuffer.Clear()
  $itemTitle.Text = ''; $detailText.Text = ''
  $itemTitle.Visibility = 'Collapsed'
  $progress.Visibility = 'Visible'
  $detailText.Visibility = 'Visible'
  Reset-Progress
  Set-State $statusStr '#8F8F97'
  Set-Busy $true
  try {
    $script:proc = Start-Hidden $ytdlp $argStr $outLog $errLog
  }
  catch {
    Set-Busy $false
    $script:singleOp = ''
    Set-State (T 'err_ytdlp_start') '#FF5C5C'
  }
}

function Build-Args($url) {
  $folder = $script:dlFolder
  if ($playlistToggle.IsChecked) {
    $plFlag = '--yes-playlist'
    $rawRange = $playlistRangeBox.Text.Trim()
    if ($rawRange) {
      if ($rawRange -match '^\d+$') {
        $plFlag += " --playlist-items `"1-$rawRange`""
      }
      else {
        $plFlag += " --playlist-items `"$rawRange`""
      }
    }
    $tpl = Join-Path $folder '%(playlist_title)s\%(playlist_index)s - %(title)s.%(ext)s'
  }
  else {
    $plFlag = '--no-playlist'
    $tpl = Join-Path $folder '%(title)s.%(ext)s'
  }
  $idx = Get-Sel $qualityPanel
  if ($idx -eq 4) {
    # MP3 320 kbps (audio ONLY — no video stream is downloaded)
    $fmt = '-f "bestaudio/best" -x --audio-format mp3 --audio-quality 320K --embed-thumbnail --add-metadata'
  }
  elseif ($idx -eq 5) {
    # FLAC / lossless (uncompressed audio)
    $fmt = '-f "bestaudio/best" -x --audio-format flac --embed-thumbnail --add-metadata'
  }
  elseif ($idx -eq 1) {
    # 1080p
    $fmt = '-f "bestvideo[height<=1080]+bestaudio/best[height<=1080]/best" --merge-output-format mp4'
  }
  elseif ($idx -eq 2) {
    # 720p
    $fmt = '-f "bestvideo[height<=720]+bestaudio/best[height<=720]/best" --merge-output-format mp4'
  }
  elseif ($idx -eq 3) {
    # 480p
    $fmt = '-f "bestvideo[height<=480]+bestaudio/best[height<=480]/best" --merge-output-format mp4'
  }
  else {
    # 0: best available
    $fmt = '-f "bestvideo+bestaudio/best" --merge-output-format mp4'
  }
  $cIdx = Get-Sel $cookiesPanel
  $cookiesArg = ''
  if ($cIdx -eq 1) {
    $cookiesArg = "--cookies `"$(Join-Path $root 'cookies.txt')`""
  }
  elseif ($cIdx -ge 2) {
    $cookiesArg = "--cookies-from-browser $($cBrowsers[$cIdx])"
  }
  $subsArg = ''
  if ($subsToggle.IsChecked -and $idx -lt 4) {
    $lang = $sLangs[(Get-Sel $subsLangPanel)]
    $subsArg = "--write-subs --write-auto-subs --sub-langs `"$lang`" --embed-subs --convert-subs srt"
  }
  $sbArg = ''
  if ($sponsorblockToggle.IsChecked -and $url -match 'youtu\.?be') {
    $sbArg = '--sponsorblock-remove sponsor,selfpromo,intro,outro,preview,filler'
  }
  $splitArg = ''
  if ($splitChaptersToggle.IsChecked) {
    # output template for chapters, otherwise yt-dlp drops the pieces into the app's working folder
    $chTpl = Join-Path $folder '%(title)s - %(section_number)02d %(section_title)s.%(ext)s'
    $splitArg = "--split-chapters -o `"chapter:$chTpl`""
  }
  $trimArg = ''
  if ($script:selectedChapters -and @($script:selectedChapters).Count -gt 0) {
    # selected chapters: each one is downloaded as a separate file (matched by chapter title)
    $secs = @($script:selectedChapters | ForEach-Object {
        $rx = [regex]::Escape([string]$_.Title) -replace '"', '.'
        "--download-sections `"^$rx$`""
      }) -join ' '
    $trimArg = "$secs --force-keyframes-at-cuts"
    $tpl = Join-Path $folder '%(title)s - %(section_title)s.%(ext)s'
  }
  elseif ($script:trimS -or $script:trimE) {
    $st = $(if ($script:trimS) { $script:trimS } else { '0' })
    $et = $(if ($script:trimE) { $script:trimE } else { 'inf' })
    $trimArg = "--download-sections `"*$st-$et`" --force-keyframes-at-cuts"
  }
  $selectedAudio = ''
  foreach ($c in $audioTracksPanel.Children) {
    if ($c.IsChecked -eq $true) { $selectedAudio = [string]$c.Tag; break }
  }
  $sortFields = @()
  $audioArg = ''
  if ($selectedAudio -eq 'all') {
    $audioArg = '--audio-multistreams'
  }
  elseif ($selectedAudio -and $selectedAudio -ne 'default') {
    $sortFields += "lang:$selectedAudio"
  }
  if ($idx -lt 4) {
    $codecIdx = Get-Sel $codecPanel
    if ($codecIdx -eq 1) { $sortFields += 'vcodec:h264' }
    elseif ($codecIdx -eq 2) { $sortFields += 'vcodec:av01' }
  }
  if ($sortFields.Count -gt 0) { $audioArg = ("$audioArg -S `"$($sortFields -join ',')`"").Trim() }

  $rateArg = ''
  $rv = $rateVals[(Get-Sel $ratePanel)]
  if ($rv) { $rateArg = "--limit-rate $rv" }

  $archArg = ''
  if ($archiveToggle.IsChecked) { $archArg = "--download-archive `"$(Join-Path $root 'download-archive.txt')`"" }

  $taggerArg = ''
  if ($smartTaggerToggle.IsChecked -and ($idx -eq 4 -or $idx -eq 5)) {
    # first artist = channel (fallback), then "Artist - Title" parsed from the title on top
    $taggerArg = '--parse-metadata "%(uploader)s:%(meta_artist)s" --parse-metadata "%(title)s:%(meta_artist)s - %(meta_title)s"'
  }

  # Multi-threaded fragment download to speed things up
  $speedArgs = '--concurrent-fragments 4 --buffer-size 16K'
  return "--newline --no-mtime --remote-components ejs:github --ffmpeg-location `"$root`" $speedArgs $rateArg $archArg $cookiesArg $subsArg $sbArg $splitArg $audioArg $taggerArg $trimArg $plFlag $fmt -o `"$tpl`" `"$url`""
}

function Set-ItemStatus($item, $status) {
  $item.Status = $status
  switch ($status) {
    'now' { $item.Dot.Fill = $window.FindResource('TFg'); $item.St.Text = T 'st_downloading' }
    'done' { $item.Dot.Fill = $brushConv.ConvertFromString('#34C759'); $item.St.Text = T 'q_done' }
    'error' { $item.Dot.Fill = $brushConv.ConvertFromString('#FF5C5C'); $item.St.Text = T 'q_error' }
    default { $item.Dot.Fill = $window.FindResource('TFgSub'); $item.St.Text = T 'q_wait' }
  }
  if ($status -ne 'wait') { $item.X.Visibility = 'Collapsed' }
  Update-ClearVis
}

function Start-Worker($item) {
  $script:workerSeq++
  $out = Join-Path $env:TEMP ('ytui_w{0}_out.log' -f $script:workerSeq)
  $err = Join-Path $env:TEMP ('ytui_w{0}_err.log' -f $script:workerSeq)
  Remove-Item $out, $err -ErrorAction SilentlyContinue
  Set-ItemStatus $item 'now'
  $w = [PSCustomObject]@{
    Item = $item; Url = $item.Url; Proc = $null
    Out = $out; Err = $err; OutPos = [long]0; ErrPos = [long]0
    Pct = 0.0; Phase = 'start'; LastFile = ''; SawSuccess = $false
    Title = ''; Detail = ''
  }
  try {
    $w.Proc = Start-Hidden $ytdlp (Build-Args $item.Url) $out $err
    [void]$script:workers.Add($w)
  }
  catch {
    Set-ItemStatus $item 'error'
    $script:queueFail++
  }
}

function Start-NextWorker {
  foreach ($it in $script:queueItems) {
    if ($it.Status -eq 'wait') { Start-Worker $it; return }
  }
}

function Process-WorkerOutput($w, $text) {
  if (-not $text) { return }
  if ($text -match 'no longer valid') { $script:cookieStale = $true }
  if ($text -match 'Failed to decrypt|failed to decrypt|could not copy .*[Cc]ookie|Could not copy .*[Cc]ookie') { $script:cookieBrowserFail = $true }

  $dm = [regex]::Match($text, 'Destination:\s*(.+)')
  if ($dm.Success) {
    $fn = Split-Path ($dm.Groups[1].Value.Trim()) -Leaf
    $fn = $fn -replace '\.f\d+\.[A-Za-z0-9]+$', '' -replace '\.[A-Za-z0-9]+$', ''
    $fn = $fn.Trim()
    if ($fn -notmatch '[\p{L}\p{N}]') { $fn = T 'fb_video' }
    $w.Title = $fn
    $w.Item.Name.Text = $fn
    if ($w.Phase -ne 'merge') {
      $w.Phase = 'download'
      if ($script:queueTotal -eq 1) { Set-State (T 'st_downloading') '#8F8F97' }
    }
  }
  if ($text -match '\[ExtractAudio\]|Extracting audio') {
    $w.Phase = 'audio'; $w.Pct = 100; $w.Item.St.Text = T 'q_processing'
    if ($script:queueTotal -eq 1) { Set-State (T 'st_convert_mp3') '#8F8F97' }
  }
  if ($text -match 'Merging formats') {
    $w.Phase = 'merge'; $w.Pct = 100; $w.Item.St.Text = T 'q_processing'; $w.Detail = ''
    if ($script:queueTotal -eq 1) { Set-State (T 'st_merging') '#8F8F97' }
  }
  if ($text -match 'Deleting original file|has already been downloaded|has already been recorded in|\[download\]\s+100% of') {
    $w.SawSuccess = $true
  }

  $fm = [regex]::Match($text, '\[Merger\] Merging formats into "(.+?)"')
  if ($fm.Success) { $w.LastFile = $fm.Groups[1].Value.Trim() }
  $am = [regex]::Match($text, '\[ExtractAudio\] Destination: (.+)')
  if ($am.Success) { $w.LastFile = $am.Groups[1].Value.Trim() }
  $hm = [regex]::Match($text, '\[download\] (.+?) has already been downloaded')
  if ($hm.Success) { $w.LastFile = $hm.Groups[1].Value.Trim() }
  $d2 = [regex]::Match($text, '\[download\] Destination: (.+)')
  if ($d2.Success) {
    $cand = $d2.Groups[1].Value.Trim()
    if ($cand -notmatch '\.f\d+\.[A-Za-z0-9]+$') { $w.LastFile = $cand }
  }

  $pm = [regex]::Matches($text, '\[download\]\s+([\d.]+)% of\s+~?\s*([\d.]+[KMGT]i?B)(?:\s+at\s+([\d.]+[KMGT]?i?B/s))?(?:\s+ETA\s+([\d:]+))?')
  if ($pm.Count -gt 0) {
    $m = $pm[$pm.Count - 1]
    $pct = [double]$m.Groups[1].Value
    if ($w.Phase -eq 'start') {
      $w.Phase = 'download'
      if ($script:queueTotal -eq 1) { Set-State (T 'st_downloading') '#8F8F97' }
    }
    if ($w.Phase -eq 'download') {
      $w.Pct = $pct
      $w.Item.St.Text = ('{0:0}%' -f $pct)
      $parts = @(('{0:0}%' -f $pct))
      if ($m.Groups[2].Success) { $parts += $m.Groups[2].Value }
      if ($m.Groups[3].Success) { $parts += $m.Groups[3].Value }
      if ($m.Groups[4].Success) { $parts += "ETA $($m.Groups[4].Value)" }
      $w.Detail = ($parts -join '   ·   ')
    }
  }
}

function Update-QueueUI {
  $done = $script:queueOk + $script:queueFail
  $sumP = 0.0
  foreach ($w in $script:workers) { $sumP += ($w.Pct / 100.0) }
  $tot = [math]::Max(1, $script:queueTotal)
  $agg = (($done + $sumP) / $tot) * 100.0
  if ([math]::Abs($agg - $script:lastAggPct) -ge 0.5) { $script:lastAggPct = $agg; Set-Progress $agg }
  Set-TaskProgress 'Normal' ([math]::Min(1.0, ($done + $sumP) / $tot))
  if ($script:workers.Count -eq 1) {
    $w = $script:workers[0]
    if ($w.Title) { $itemTitle.Text = $w.Title; $itemTitle.Visibility = 'Visible' }
    if ($w.Detail) { $detailText.Text = $w.Detail; $detailText.Visibility = 'Visible' }
  }
  elseif ($script:workers.Count -gt 1) {
    $itemTitle.Visibility = 'Collapsed'
    $waiting = @($script:queueItems | Where-Object { $_.Status -eq 'wait' }).Count
    $detailText.Text = ((T 'st_parallel') -f $script:workers.Count) + $(if ($waiting -gt 0) { (T 'st_queued') -f $waiting } else { '' })
    $detailText.Visibility = 'Visible'
  }
  if ($script:queueTotal -gt 1) { Set-State ((T 'st_dl_progress') -f $done, $script:queueTotal) '#8F8F97' }
}

function Make-ShortName($url) {
  $u = $url -replace '^https?://(www\.)?', ''
  if ($u.Length -gt 50) { $u = $u.Substring(0, 48) + '…' }
  return $u
}

function Update-ClearVis {
  $waiting = @($script:queueItems | Where-Object { $_.Status -eq 'wait' }).Count
  $clearQueueBtn.Visibility = $(if ($waiting -gt 0) { 'Visible' } else { 'Collapsed' })
}

function Add-QueueRow($url) {
  $row = New-Object System.Windows.Controls.Border
  $row.CornerRadius = New-Object System.Windows.CornerRadius 8
  $row.Background = $window.FindResource('TGlass')
  $row.Padding = New-Object System.Windows.Thickness 10, 6, 10, 6
  $row.Margin = New-Object System.Windows.Thickness 0, 0, 0, 6

  $grid = New-Object System.Windows.Controls.Grid
  $c0 = New-Object System.Windows.Controls.ColumnDefinition; $c0.Width = [System.Windows.GridLength]::Auto
  $c1 = New-Object System.Windows.Controls.ColumnDefinition; $c1.Width = New-Object System.Windows.GridLength(1, [System.Windows.GridUnitType]::Star)
  $c2 = New-Object System.Windows.Controls.ColumnDefinition; $c2.Width = [System.Windows.GridLength]::Auto
  $c3 = New-Object System.Windows.Controls.ColumnDefinition; $c3.Width = [System.Windows.GridLength]::Auto
  $grid.ColumnDefinitions.Add($c0); $grid.ColumnDefinitions.Add($c1); $grid.ColumnDefinitions.Add($c2); $grid.ColumnDefinitions.Add($c3)

  $dot = New-Object System.Windows.Shapes.Ellipse
  $dot.Width = 8; $dot.Height = 8; $dot.Fill = $window.FindResource('TFgSub')
  $dot.VerticalAlignment = 'Center'; $dot.Margin = New-Object System.Windows.Thickness 0, 0, 9, 0
  [System.Windows.Controls.Grid]::SetColumn($dot, 0)

  $name = New-Object System.Windows.Controls.TextBlock
  $name.Text = (Make-ShortName $url); $name.Foreground = $window.FindResource('TFg')
  $name.FontSize = 12; $name.VerticalAlignment = 'Center'; $name.TextTrimming = 'CharacterEllipsis'
  [System.Windows.Controls.Grid]::SetColumn($name, 1)

  $st = New-Object System.Windows.Controls.TextBlock
  $st.Text = T 'q_wait'; $st.Foreground = $window.FindResource('TFgDim')
  $st.FontSize = 11; $st.VerticalAlignment = 'Center'; $st.Margin = New-Object System.Windows.Thickness 8, 0, 8, 0
  [System.Windows.Controls.Grid]::SetColumn($st, 2)

  $x = New-Object System.Windows.Controls.TextBlock
  $x.Text = '✕'; $x.Foreground = $window.FindResource('TFgDim')
  $x.FontSize = 12; $x.VerticalAlignment = 'Center'; $x.Cursor = [System.Windows.Input.Cursors]::Hand
  [System.Windows.Controls.Grid]::SetColumn($x, 3)

  $grid.Children.Add($dot); $grid.Children.Add($name); $grid.Children.Add($st); $grid.Children.Add($x)
  $row.Child = $grid

  $item = [PSCustomObject]@{ Url = $url; Row = $row; Dot = $dot; Name = $name; St = $st; X = $x; Status = 'wait' }
  $x.Tag = $item
  $x.Add_MouseLeftButtonDown({ param($s, $e) $e.Handled = $true; Remove-QueueItem $s.Tag })
  [void]$queuePanel.Children.Add($row)
  [void]$script:queueItems.Add($item)
}

function Build-QueueList($urls) {
  $queuePanel.Children.Clear()
  $script:queueItems.Clear()
  foreach ($u in $urls) { Add-QueueRow $u }
  if ($urls.Count -gt 1) {
    $queueScroll.Visibility = 'Visible'
    Set-WinHeight $script:hQueue
  }
  else {
    $queueScroll.Visibility = 'Collapsed'
    Set-WinHeight $script:hBase
  }
  Update-ClearVis
}

function Remove-QueueItem($item) {
  if ($item.Status -ne 'wait') { return }
  [void]$queuePanel.Children.Remove($item.Row)
  [void]$script:queueItems.Remove($item)
  $script:queueTotal = [math]::Max(0, $script:queueTotal - 1)
  Update-ClearVis
}

function Clear-WaitingQueue {
  $toRemove = @($script:queueItems | Where-Object { $_.Status -eq 'wait' })
  foreach ($it in $toRemove) { Remove-QueueItem $it }
}

# output polling timer
$timer = New-Object System.Windows.Threading.DispatcherTimer
$timer.Interval = [TimeSpan]::FromMilliseconds(200)
$timer.Add_Tick({
    # --- single operations: yt-dlp update, thumbnail, local conversion ---
    Process-Output (Read-NewText $outLog ([ref]$script:outPos))
    Process-Output (Read-NewText $errLog ([ref]$script:errPos))
    if ($script:proc -and $script:proc.HasExited) {
      $code = $script:proc.ExitCode
      $script:proc = $null
      Start-Sleep -Milliseconds 150
      Process-Output (Read-NewText $outLog ([ref]$script:outPos))
      Process-Output (Read-NewText $errLog ([ref]$script:errPos))
      try { Set-Content -Path $logFile -Value $script:logBuffer.ToString() -Encoding UTF8 } catch {}

      if ($script:cancelled) {
        Set-State (T 'st_cancelled') '#FFB340'; $detailText.Text = ''
        Reset-Progress
        Set-TaskProgress 'None' -1
      }
      elseif ($script:singleOp -eq 'convert') {
        if ($code -eq 0 -and $script:lastFile -and (Test-Path $script:lastFile)) {
          Set-State (T 'st_done') '#34C759'
          $detailText.Text = T 'det_file_saved'
          Add-HistoryItem ([System.IO.Path]::GetFileNameWithoutExtension($script:lastFile)) '' $script:lastFile
          $openFileBtn.Visibility = 'Visible'
          Notify 'Deviload' (T 'ntf_convert_done')
        }
        else { Set-State ((T 'st_convert_err') -f $code) '#FF5C5C' }
        Set-Progress 100
        Set-TaskProgress 'None' -1
      }
      else {
        if ($code -eq 0 -or $script:sawSuccess) {
          Set-State (T 'st_done') '#34C759'
          if ($script:singleOp -eq 'thumb' -and $script:lastFile -and (Test-Path $script:lastFile)) { $openFileBtn.Visibility = 'Visible' }
        }
        else { Set-State ((T 'st_err_code') -f $code) '#FF5C5C' }
        Set-TaskProgress 'None' -1
      }
      $script:singleOp = ''
      Set-Busy $false
    }

    # --- parallel download pool ---
    if ($script:queueActive) {
      foreach ($w in $script:workers.ToArray()) {
        $p = $w.OutPos; $t = Read-NewText $w.Out ([ref]$p); $w.OutPos = $p
        if ($t) { [void]$script:logBuffer.Append($t); Process-WorkerOutput $w $t }
        $p = $w.ErrPos; $t = Read-NewText $w.Err ([ref]$p); $w.ErrPos = $p
        if ($t) { [void]$script:logBuffer.Append($t); Process-WorkerOutput $w $t }

        if ($w.Proc -and $w.Proc.HasExited) {
          $p = $w.OutPos; $t = Read-NewText $w.Out ([ref]$p); $w.OutPos = $p
          if ($t) { [void]$script:logBuffer.Append($t); Process-WorkerOutput $w $t }
          $p = $w.ErrPos; $t = Read-NewText $w.Err ([ref]$p); $w.ErrPos = $p
          if ($t) { [void]$script:logBuffer.Append($t); Process-WorkerOutput $w $t }
          [void]$script:workers.Remove($w)
          if ($script:cancelled) {
            Set-ItemStatus $w.Item 'error'
            $w.Item.St.Text = T 'q_cancelled'
          }
          else {
            $ok = ($w.Proc.ExitCode -eq 0 -or $w.SawSuccess)
            Set-ItemStatus $w.Item $(if ($ok) { 'done' } else { 'error' })
            if ($ok) {
              $script:queueOk++
              if ($w.LastFile) {
                $script:lastFile = $w.LastFile
                Add-HistoryItem ([System.IO.Path]::GetFileNameWithoutExtension($w.LastFile)) $w.Url $w.LastFile
              }
            }
            else { $script:queueFail++ }
            Start-NextWorker
          }
        }
      }

      if ($script:workers.Count -gt 0) {
        Update-QueueUI
      }
      elseif ($script:cancelled) {
        $script:queueActive = $false
        try { Set-Content -Path $logFile -Value $script:logBuffer.ToString() -Encoding UTF8 } catch {}
        Set-State (T 'st_cancelled') '#FFB340'; $detailText.Text = ''
        Reset-Progress
        Set-TaskProgress 'None' -1
        Set-Busy $false
      }
      else {
        $waiting = @($script:queueItems | Where-Object { $_.Status -eq 'wait' }).Count
        if ($waiting -gt 0) {
          # safety net: a worker did not start — try the next one
          Start-NextWorker
        }
        else {
          $script:queueActive = $false
          try { Set-Content -Path $logFile -Value $script:logBuffer.ToString() -Encoding UTF8 } catch {}
          Set-Progress 100
          Set-TaskProgress 'None' -1
          if ($script:queueTotal -gt 1) {
            if ($script:queueFail -eq 0) { Set-State ((T 'st_dl_all') -f $script:queueOk, $script:queueTotal) '#34C759' }
            else { Set-State ((T 'st_dl_partial') -f $script:queueOk, $script:queueTotal, $script:queueFail) '#FFB340' }
            $detailText.Text = T 'det_files_saved'
            Notify 'Deviload' ((T 'ntf_done_n') -f $script:queueOk, $script:queueTotal)
          }
          elseif ($script:queueFail -eq 0) {
            if ($script:cookieStale) { Set-State (T 'st_dl_cookies_stale') '#34C759' }
            else { Set-State (T 'st_downloaded') '#34C759' }
            $detailText.Text = T 'det_file_saved'
            Notify 'Deviload' (T 'st_downloaded')
          }
          else {
            if ($script:cookieBrowserFail) {
              Set-State (T 'st_cookie_browser_fail') '#FF5C5C'
              $detailText.Text = T 'det_cookie_browser_fail'
            }
            else {
              Set-State (T 'st_dl_failed') '#FF5C5C'
              $detailText.Text = T 'det_see_log'
            }
            Notify 'Deviload' (T 'st_dl_failed')
          }
          if ($script:lastFile -and (Test-Path $script:lastFile)) {
            $openFileBtn.Visibility = 'Visible'
            try {
              $script:mp.Open((New-Object System.Uri $script:lastFile))
              $script:playerSrc = $script:lastFile
              $script:playing = $false
              $playGlyph.Text = [char]0xE768
              $playerBar.Value = 0; $curTime.Text = '0:00'
              if (-not $previewTitle.Text -or $previewTitle.Text -eq (T 'pv_loading')) {
                $previewTitle.Text = [System.IO.Path]::GetFileNameWithoutExtension($script:lastFile)
              }
              $previewCard.Visibility = 'Visible'
            }
            catch {}
          }
          Set-Busy $false
        }
      }
    }

    if ($script:previewProc -and $script:previewProc.HasExited) {
      $script:previewProc = $null
      if (Test-Path $previewJson) {
        try {
          $raw = Get-Content $previewJson -Raw -Encoding UTF8 -ErrorAction Stop
          $j = $raw | ConvertFrom-Json
          if ($j.title) { $previewTitle.Text = $j.title } else { $previewTitle.Text = T 'pv_untitled' }
          if ($null -ne $j.duration) {
            $script:vidDur = [double]$j.duration
            $ts = [TimeSpan]::FromSeconds([double]$j.duration)
            $totalTime.Text = $(if ($ts.TotalHours -ge 1) { '{0}:{1:d2}:{2:d2}' -f [int]$ts.TotalHours, $ts.Minutes, $ts.Seconds } else { '{0}:{1:d2}' -f [int]$ts.TotalMinutes, $ts.Seconds })
            $curTime.Text = '0:00'
          }
          else { $script:vidDur = 0.0; $totalTime.Text = '0:00' }
          # approximate file size
          $szBytes = 0.0
          try {
            if ($j.requested_formats) {
              foreach ($rf in $j.requested_formats) {
                if ($rf.filesize) { $szBytes += [double]$rf.filesize }
                elseif ($rf.filesize_approx) { $szBytes += [double]$rf.filesize_approx }
              }
            }
            if ($szBytes -le 0 -and $j.filesize_approx) { $szBytes = [double]$j.filesize_approx }
            if ($szBytes -le 0 -and $j.filesize) { $szBytes = [double]$j.filesize }
          }
          catch {}
          $previewSize.Text = $(if ($szBytes -gt 0) { '≈ ' + (Format-Bytes $szBytes) } else { '' })
          $audioTracksPanel.Children.Clear()
          $langs = New-Object System.Collections.Generic.HashSet[string]
          if ($j.formats) {
            foreach ($f in $j.formats) {
              if ($f.acodec -and $f.acodec -ne 'none' -and $f.language) {
                [void]$langs.Add([string]$f.language)
              }
            }
          }
          if ($langs.Count -gt 1) {
            $script:availableAudioLangs = @('default') + @($langs) + @('all')
            for ($k = 0; $k -lt $script:availableAudioLangs.Count; $k++) {
              $code = $script:availableAudioLangs[$k]
              $lbl = Get-AudioLabel $code
              $rb = New-Object System.Windows.Controls.RadioButton
              $rb.Content = $lbl; $rb.GroupName = 'audioTrack'; $rb.Style = $pillStyle; $rb.Tag = $code
              if ($code -eq 'ru') { $rb.IsChecked = $true }
              elseif ($k -eq 0 -and (-not ($langs.Contains('ru')))) { $rb.IsChecked = $true }
              [void]$audioTracksPanel.Children.Add($rb)
            }
            $audioTracksContainer.Visibility = 'Visible'
          }
          else {
            $audioTracksContainer.Visibility = 'Collapsed'
          }
          Update-TrimFromTrack
          Set-Chapters $j.chapters $script:vidDur
          if (@($script:chapterData).Count -gt 1) {
            $chaptersBtn.Content = (T 'btn_chapters_n') -f @($script:chapterData).Count
            $chaptersBtn.Visibility = 'Visible'
          }
          else { $chaptersBtn.Visibility = 'Collapsed' }
          $script:streamUrl = ''
          if ($j.formats) {
            foreach ($f in $j.formats) {
              if ($f.url -and $f.acodec -and $f.acodec -ne 'none' -and $f.vcodec -and $f.vcodec -ne 'none' -and ([string]$f.protocol) -match 'http') { $script:streamUrl = [string]$f.url }
            }
          }
          if (-not $script:streamUrl -and $j.url) { $script:streamUrl = [string]$j.url }
          if ($j.thumbnail) {
            $bi = New-Object System.Windows.Media.Imaging.BitmapImage
            $bi.BeginInit(); $bi.UriSource = New-Object System.Uri ([string]$j.thumbnail); $bi.EndInit()
            $previewImg.Source = $bi
          }
        }
        catch {
          $previewTitle.Text = T 'pv_failed'
          $totalTime.Text = '0:00'
        }
      }
      else {
        $previewTitle.Text = T 'pv_failed'
        $totalTime.Text = '0:00'
      }
    }

    if ($script:gifProc -and $script:gifProc.HasExited) {
      $script:gifProc = $null
      Set-Busy $false
      if (Test-Path $script:gifOut) {
        Set-State (T 'st_gif_done') '#34C759'
        $detailText.Text = T 'det_gif_saved'; $detailText.Visibility = 'Visible'
        $script:lastFile = $script:gifOut; $script:playerSrc = ''; $openFileBtn.Visibility = 'Visible'
      }
      else {
        Set-State (T 'st_gif_failed') '#FF5C5C'
        $detailText.Text = T 'det_gif_log'; $detailText.Visibility = 'Visible'
        try { if (Test-Path $gifLog) { Start-Process notepad.exe $gifLog } } catch {}
      }
    }

    if ($script:searchProc -and $script:searchProc.HasExited) {
      $script:searchProc = $null
      $searchResults.Children.Clear()
      if (Test-Path $searchJson) {
        try {
          $lines = Get-Content $searchJson -Encoding UTF8 -ErrorAction SilentlyContinue
          $count = 0
          foreach ($line in $lines) {
            if (-not $line -or -not $line.Trim()) { continue }
            $r = $null; try { $r = $line | ConvertFrom-Json } catch { continue }
            if ($r -and $r.id) { Add-SearchRow $r; $count++ }
          }
          if ($count -eq 0) {
            $tb = New-Object System.Windows.Controls.TextBlock
            $tb.Text = T 'none_found'; $tb.Foreground = $window.FindResource('TFgDim')
            $tb.Margin = New-Object System.Windows.Thickness 4, 8, 0, 0
            [void]$searchResults.Children.Add($tb)
          }
        }
        catch {}
      }
      else {
        $tb = New-Object System.Windows.Controls.TextBlock
        $tb.Text = T 'none_found'; $tb.Foreground = $window.FindResource('TFgDim')
        $tb.Margin = New-Object System.Windows.Thickness 4, 8, 0, 0
        [void]$searchResults.Children.Add($tb)
      }
    }

    if ($script:playing -and $script:playerDur -gt 0) {
      try {
        $playerBar.Value = ($script:mp.Position.TotalSeconds / $script:playerDur) * 100
        $curTime.Text = Format-Time $script:mp.Position.TotalSeconds
      }
      catch {}
    }
  })
$timer.Start()

# auto-preview debounce
$previewDebounce = New-Object System.Windows.Threading.DispatcherTimer
$previewDebounce.Interval = [TimeSpan]::FromMilliseconds(700)
$previewDebounce.Add_Tick({ $previewDebounce.Stop(); Fetch-Preview })

# player events
$script:mp.Add_MediaOpened({
    try { $script:playerDur = $script:mp.NaturalDuration.TimeSpan.TotalSeconds } catch { $script:playerDur = 0 }
    try { $totalTime.Text = Format-Time $script:playerDur } catch {}
  })
$script:mp.Add_MediaEnded({
    if ($script:repeat) {
      try { $script:mp.Position = [TimeSpan]::Zero; $script:mp.Play() } catch {}
    }
    else {
      try { $script:mp.Stop() } catch {}
      $script:playing = $false; $playGlyph.Text = [char]0xE768; $playerBar.Value = 0; $curTime.Text = '0:00'
    }
  })

# ---------------- events ----------------
# clipboard watcher: copy a link and it lands in the queue by itself
$script:lastClipSeen = ''
$clipTimer = New-Object System.Windows.Threading.DispatcherTimer
$clipTimer.Interval = [TimeSpan]::FromMilliseconds(1000)
$clipTimer.Add_Tick({
    if (-not $clipWatchToggle.IsChecked) { return }
    $clip = ''
    try {
      if (-not [System.Windows.Clipboard]::ContainsText()) { return }
      $clip = [System.Windows.Clipboard]::GetText()
    }
    catch { return }
    if (-not $clip) { return }
    $clip = $clip.Trim()
    if ($clip -eq $script:lastClipSeen) { return }
    $script:lastClipSeen = $clip
    if ($clip -notmatch '^(https?://|magnet:\?)\S+$') { return }
    if ($urlBox.Text -match [regex]::Escape($clip)) { return }
    if ($urlBox.Text.Trim()) { $urlBox.AppendText("`r`n" + $clip) } else { $urlBox.Text = $clip }
    $urlBox.CaretIndex = $urlBox.Text.Length
  })
$clipTimer.Start()

function Start-LocalConvert($file) {
  if (-not (Test-Path $file)) { return }
  if ($script:queueActive -or ($script:proc -and -not $script:proc.HasExited)) { Set-State (T 'st_busy') '#FFB340'; return }
  $ffmpegExe = Join-Path $root 'ffmpeg.exe'
  if (-not (Test-Path $ffmpegExe)) { Set-State (T 'err_no_ffmpeg') '#FF5C5C'; return }
  $folder = $folderBox.Text.Trim(); if (-not $folder) { $folder = $defaultFolder }
  if (-not (Test-Path $folder)) { try { New-Item -ItemType Directory -Path $folder -Force | Out-Null } catch {} }
  $baseName = [System.IO.Path]::GetFileNameWithoutExtension($file)
  $idx = Get-Sel $qualityPanel
  Set-Busy $true
  Reset-Progress
  $script:phase = 'convert'
  $itemTitle.Text = (T 'st_convert_title') -f $baseName
  $itemTitle.Visibility = 'Visible'
  $progress.Visibility = 'Visible'
  $detailText.Text = T 'det_convert_local'
  $detailText.Visibility = 'Visible'
  Set-State (T 'st_converting') '#8F8F97'

  if ($idx -eq 4) {
    $out = Join-Path $folder "$baseName.mp3"
    $args = "-y -i `"$file`" -vn -c:a libmp3lame -b:a 320k `"$out`""
  }
  elseif ($idx -eq 5) {
    $out = Join-Path $folder "$baseName.flac"
    $args = "-y -i `"$file`" -vn -c:a flac `"$out`""
  }
  else {
    $out = Join-Path $folder "$baseName.mp4"
    $args = "-y -i `"$file`" -c:v libx264 -preset fast -crf 22 -c:a aac -b:a 192k `"$out`""
  }
  $script:lastFile = $out
  $script:singleOp = 'convert'
  $script:cancelled = $false
  [void]$script:logBuffer.Clear()
  $script:outPos = 0; $script:errPos = 0
  Remove-Item $outLog, $errLog -ErrorAction SilentlyContinue
  try {
    $script:proc = Start-Hidden $ffmpegExe $args $outLog $errLog
  }
  catch {
    Set-State (T 'err_convert_start') '#FF5C5C'
    $script:singleOp = ''
    Set-Busy $false
  }
}

$window.Add_DragOver({
    param($s, $e)
    if ($e.Data.GetDataPresent([System.Windows.DataFormats]::FileDrop) -or $e.Data.GetDataPresent([System.Windows.DataFormats]::Text) -or $e.Data.GetDataPresent([System.Windows.DataFormats]::UnicodeText)) {
      $e.Effects = [System.Windows.DragDropEffects]::Copy
      $e.Handled = $true
    }
  })

$window.Add_Drop({
    param($s, $e)
    try {
      if ($e.Data.GetDataPresent([System.Windows.DataFormats]::FileDrop)) {
        $files = $e.Data.GetData([System.Windows.DataFormats]::FileDrop)
        if ($files) {
          foreach ($f in $files) {
            if ($f -like '*.torrent') { Start-Torrent $f; return }
            if ($f -match '\.(mkv|mov|avi|webm|flv|wmv|mp4|wav|flac|m4a|aac|ogg|opus)$') {
              Start-LocalConvert $f
              return
            }
          }
        }
      }
      if ($e.Data.GetDataPresent([System.Windows.DataFormats]::Text)) {
        $txt = $e.Data.GetData([System.Windows.DataFormats]::Text)
        if ($txt) {
          $txt = $txt.Trim()
          if ($urlBox.Text.Trim()) { $urlBox.AppendText("`r`n" + $txt) } else { $urlBox.Text = $txt }
        }
      }
    }
    catch {}
  })

$playlistToggle.Add_Click({
    if ($playlistToggle.IsChecked) {
      $playlistRangeBox.Visibility = 'Visible'
      if (-not $playlistRangeBox.Text) { $playlistRangeHint.Visibility = 'Visible' }
    }
    else {
      $playlistRangeBox.Visibility = 'Collapsed'
      $playlistRangeHint.Visibility = 'Collapsed'
    }
  })

$playlistRangeBox.Add_TextChanged({
    $playlistRangeHint.Visibility = $(if ($playlistRangeBox.Text.Length -gt 0) { 'Collapsed' } else { 'Visible' })
  })

$downloadThumbBtn.Add_MouseLeftButtonDown({
    param($s, $e)
    $e.Handled = $true
    if ($script:queueActive -or $script:proc) { Set-State (T 'st_busy') '#FFB340'; return }
    $u = @($urlBox.Text -split "[\r\n\s]+" | ForEach-Object { $_.Trim() } | Where-Object { $_ })[0]
    if (-not $u) { Set-State (T 'st_need_url') '#FFB340'; return }
    $folder = $folderBox.Text.Trim(); if (-not $folder) { $folder = $defaultFolder }
    if (-not (Test-Path $folder)) { try { New-Item -ItemType Directory -Path $folder -Force | Out-Null } catch {} }
    Set-State (T 'st_thumb_dl') '#8F8F97'
    $tpl = Join-Path $folder '%(title)s.%(ext)s'
    $argStr = "--write-thumbnail --skip-download --convert-thumbnails png -o `"$tpl`" `"$u`""
    Start-YtDlp $argStr (T 'st_thumb_dl') 'thumb'
  })

$presetDownloads.Add_MouseLeftButtonDown({ param($s, $e) $folderBox.Text = Join-Path ([Environment]::GetFolderPath('UserProfile')) 'Downloads' })
$presetMusic.Add_MouseLeftButtonDown({ param($s, $e) $folderBox.Text = [Environment]::GetFolderPath('MyMusic') })
$presetDesktop.Add_MouseLeftButtonDown({ param($s, $e) $folderBox.Text = [Environment]::GetFolderPath('Desktop') })

$historyBtn.Add_MouseLeftButtonDown({
    param($s, $e)
    Render-History $historySearchBox.Text.Trim()
    $historyOverlay.Visibility = 'Visible'
  })
$historyCloseBtn.Add_Click({ $historyOverlay.Visibility = 'Collapsed' })
$clearHistoryBtn.Add_Click({
    Remove-Item $historyFile -ErrorAction SilentlyContinue
    Render-History
  })
$historySearchBox.Add_TextChanged({
    $historySearchHint.Visibility = $(if ($historySearchBox.Text.Length -gt 0) { 'Collapsed' } else { 'Visible' })
    Render-History $historySearchBox.Text.Trim()
  })
$historyOverlay.Add_MouseLeftButtonDown({ param($s, $e) if ($e.OriginalSource -eq $historyOverlay) { $historyOverlay.Visibility = 'Collapsed' } })

$pasteBtn.Add_Click({
    $t = [System.Windows.Clipboard]::GetText()
    if ($t) {
      $t = $t.Trim()
      if ($urlBox.Text.Trim()) { $urlBox.AppendText("`r`n" + $t) } else { $urlBox.Text = $t }
      $urlBox.CaretIndex = $urlBox.Text.Length
    }
  })

$clearBtn.Add_Click({
    $urlBox.Text = ''
    $previewCard.Visibility = 'Collapsed'
    try { $script:mp.Stop() } catch {}
    $urlBox.Focus()
  })

$torrentBtn.Add_Click({
    $t = ''
    foreach ($line in ($urlBox.Text -split "[\r\n]+")) { if ($line -match 'magnet:\?xt=') { $t = $line.Trim(); break } }
    if (-not $t -and ($urlBox.Text.Trim() -match '^magnet:')) { $t = $urlBox.Text.Trim() }
    if ($t) { Start-Torrent $t; return }
    try {
      $dlg = New-Object System.Windows.Forms.OpenFileDialog
      $dlg.Filter = T 'dlg_torrent_filter'
      if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Start-Torrent $dlg.FileName }
      else { Set-State (T 'st_magnet_hint') '#FFB340' }
    }
    catch { Set-State (T 'st_magnet_hint2') '#FFB340' }
  })

$browseBtn.Add_Click({
    $dlg = New-Object System.Windows.Forms.FolderBrowserDialog
    if (Test-Path $folderBox.Text) { $dlg.SelectedPath = $folderBox.Text }
    if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $folderBox.Text = $dlg.SelectedPath }
  })

$openBtn.Add_Click({ if (Test-Path $folderBox.Text) { Start-Process explorer.exe $folderBox.Text } })

$urlBox.Add_TextChanged({
    $urlHint.Visibility = $(if ($urlBox.Text.Length -gt 0) { 'Collapsed' } else { 'Visible' })
    $previewDebounce.Stop(); $previewDebounce.Start()
  })

$logBtn.Add_Click({
    if (Test-Path $logFile) { Start-Process notepad.exe $logFile }
    else { Set-State (T 'st_log_empty') '#FFB340' }
  })

function Fetch-Preview {
  $u = @($urlBox.Text -split "[\r\n\s]+" | ForEach-Object { $_.Trim() } | Where-Object { $_ })[0]
  if (-not $u) { return }
  if ($u -notmatch '^https?://') {
    if ($u -match '^[\w-]+\.[\w-]+') { $u = "https://$u" } else { return }
  }
  if ($u -eq $script:lastPreviewUrl) { return }
  if ($script:previewProc -and -not $script:previewProc.HasExited) {
    Kill-Tree $script:previewProc.Id
    $script:previewProc = $null
  }
  $script:lastPreviewUrl = $u
  $cIdx = Get-Sel $cookiesPanel
  $cookiesArg = ''
  if ($cIdx -eq 1) { $cf = Join-Path $root 'cookies.txt'; if (Test-Path $cf) { $cookiesArg = "--cookies `"$cf`"" } }
  elseif ($cIdx -ge 2) { $cookiesArg = "--cookies-from-browser $($cBrowsers[$cIdx])" }
  Remove-Item $previewJson, ($previewJson + '.err') -ErrorAction SilentlyContinue
  $previewTitle.Text = T 'pv_loading'; $previewImg.Source = $null
  $previewSize.Text = ''
  $script:vidDur = 0.0
  $script:selectedChapters = @()
  $chaptersBtn.Content = T 'btn_chapters'
  $chaptersBtn.Visibility = 'Collapsed'
  try { $script:mp.Stop() } catch {}
  $script:playing = $false; $script:playerSrc = ''; $script:lastFile = ''
  $playGlyph.Text = [char]0xE768; $curTime.Text = '0:00'; $totalTime.Text = '—'; $playerBar.Value = 0
  $previewCard.Visibility = 'Visible'
  $script:streamUrl = ''
  $argStr = "--dump-single-json --no-playlist --skip-download --remote-components ejs:github --ffmpeg-location `"$root`" $cookiesArg `"$u`""
  try {
    $script:previewProc = Start-Hidden $ytdlp $argStr $previewJson ($previewJson + '.err')
  }
  catch { $previewTitle.Text = T 'pv_failed' }
}

$previewClose.Add_MouseLeftButtonDown({ param($s, $e) $e.Handled = $true; $previewCard.Visibility = 'Collapsed' })

$openFileBtn.Add_Click({
    if ($script:lastFile -and (Test-Path $script:lastFile)) {
      Start-Process explorer.exe "/select,`"$($script:lastFile)`""
    }
    elseif (Test-Path $folderBox.Text) {
      Start-Process explorer.exe $folderBox.Text
    }
  })

$gifBtn.Add_Click({
    $u = @($urlBox.Text -split "[\r\n\s]+" | ForEach-Object { $_.Trim() } | Where-Object { $_ })[0]
    if (-not $u) { Set-State (T 'st_gif_need_url') '#FFB340'; return }
    if ($u -notmatch '^https?://') {
      if ($u -match '^[\w-]+\.[\w-]+') { $u = "https://$u" } else { Set-State (T 'st_not_url') '#FFB340'; return }
    }
    $folder = $folderBox.Text.Trim(); if (-not $folder) { $folder = $defaultFolder }
    if (-not (Test-Path $folder)) { try { New-Item -ItemType Directory -Path $folder -Force | Out-Null } catch { Set-State (T 'err_folder') '#FF5C5C'; return } }
    # cut points in seconds + duration cap: a short GIF is faster and more reliable
    $ss = $(if ($script:trimS) { Parse-Time $script:trimS } else { 0.0 })
    $ee = $(if ($script:trimE) { Parse-Time $script:trimE } else { $ss + 8 })
    if ($ee -le $ss) { $ee = $ss + 8 }
    if (($ee - $ss) -gt 15) { $ee = $ss + 15 }     # 15 s max per GIF
    $st = ('{0:0.##}' -f $ss); $et = ('{0:0.##}' -f $ee)
    $cIdx = Get-Sel $cookiesPanel
    $cookiesArg = ''
    if ($cIdx -eq 1) { $cf = Join-Path $root 'cookies.txt'; if (Test-Path $cf) { $cookiesArg = "--cookies `"$cf`"" } }
    elseif ($cIdx -ge 2) { $cookiesArg = "--cookies-from-browser $($cBrowsers[$cIdx])" }
    $clip = Join-Path $env:TEMP 'ytui_clip.mp4'
    $script:gifOut = Join-Path $folder ('gif_' + (Get-Date -Format 'yyyyMMdd_HHmmss') + '.gif')
    $vf = 'fps=12,scale=480:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse'
    # -f prefers a ready progressive format <=480 (fast, no merge), no --force-keyframes (no slow re-encode)
    $fmtSel = 'b[height<=480]/bv*[height<=480]/bv*/b'
    $bat = "@echo off`r`nchcp 65001 >nul`r`n`"$ytdlp`" --no-playlist --no-mtime $cookiesArg --remote-components ejs:github --download-sections `"*$st-$et`" -f `"$fmtSel`" -S `"res:480`" --ffmpeg-location `"$root`" -o `"$clip`" `"$u`"`r`nif not exist `"$clip`" exit /b 1`r`n`"$ffmpeg`" -y -i `"$clip`" -vf `"$vf`" `"$($script:gifOut)`"`r`n"
    Set-Content -Path $gifBat -Value $bat -Encoding OEM
    Remove-Item $clip -ErrorAction SilentlyContinue
    Set-State (T 'st_gif_making') '#8F8F97'; $detailText.Text = ''; Set-Busy $true
    try { $script:gifProc = Start-Hidden $gifBat '' $gifLog ($gifLog + '.err') }
    catch { Set-Busy $false; Set-State (T 'err_gif_start') '#FF5C5C' }
  })

function Toggle-Play {
  $src = $(if ($script:lastFile) { $script:lastFile } elseif ($script:streamUrl) { $script:streamUrl } else { '' })
  if (-not $src) { return }
  if ($script:playerSrc -ne $src) {
    try { $script:mp.Open((New-Object System.Uri $src)); $script:playerSrc = $src; $script:playing = $false } catch {}
  }
  if ($script:playing) {
    try { $script:mp.Pause() } catch {}
    $script:playing = $false
    $playGlyph.Text = [char]0xE768
  }
  else {
    try { $script:mp.Play() } catch {}
    $script:playing = $true
    $playGlyph.Text = [char]0xE769
  }
}
function Find-Qbittorrent {
  foreach ($p in @(
      "$env:ProgramFiles\qBittorrent\qbittorrent.exe",
      "${env:ProgramFiles(x86)}\qBittorrent\qbittorrent.exe",
      "$env:LOCALAPPDATA\Programs\qBittorrent\qbittorrent.exe"
    )) { if (Test-Path $p) { return $p } }
  return $null
}
function Get-VlcPath {
  return @("$env:ProgramFiles\VideoLAN\VLC\vlc.exe", "${env:ProgramFiles(x86)}\VideoLAN\VLC\vlc.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
}
function Get-QbDefaultSave {
  # read the qBittorrent download folder from its config (in case --save-path is ignored)
  $ini = Join-Path $env:APPDATA 'qBittorrent\qBittorrent.ini'
  if (Test-Path $ini) {
    try {
      foreach ($line in (Get-Content $ini -ErrorAction SilentlyContinue)) {
        if ($line -match '(?:DefaultSavePath|Downloads\\SavePath)\s*=\s*(.+?)\s*$') {
          $p = $matches[1].Trim('"').Replace('/', '\')
          if ($p) { return $p }
        }
      }
    }
    catch {}
  }
  return (Join-Path $env:USERPROFILE 'Downloads')
}
function Stop-Torrent {
  try { if ($script:torWait) { $script:torWait.Stop() } } catch {}
}

function Open-TorrentStream($url, $name) {
  $script:torUrl = $url
  $script:torVlc = @("$env:ProgramFiles\VideoLAN\VLC\vlc.exe", "${env:ProgramFiles(x86)}\VideoLAN\VLC\vlc.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $script:hasWV2) {
    if ($script:torVlc) { Start-Process $script:torVlc $url } else { Set-State (T 'err_need_wv2') '#FF5C5C' }
    return
  }
  try {
    $tw = New-Object System.Windows.Window
    $tw.Title = $(if ($name) { $name } else { T 'ttl_torrent' })
    $tw.Width = 1000; $tw.Height = 650
    $tw.WindowStartupLocation = 'CenterScreen'
    $tw.Background = [System.Windows.Media.Brushes]::Black
    $dock = New-Object System.Windows.Controls.DockPanel
    $bar = New-Object System.Windows.Controls.DockPanel
    [System.Windows.Controls.DockPanel]::SetDock($bar, 'Bottom')
    $bar.LastChildFill = $false
    $bar.Margin = '10,8,10,8'
    $vbtn = New-Object System.Windows.Controls.Button
    $vbtn.Content = $(if ($script:torVlc) { T 'btn_vlc' } else { T 'btn_vlc_none' })
    $vbtn.Padding = '14,6'; $vbtn.IsEnabled = [bool]$script:torVlc
    [System.Windows.Controls.DockPanel]::SetDock($vbtn, 'Right')
    $vbtn.Add_Click({ try { if ($script:torVlc) { Start-Process $script:torVlc $script:torUrl } } catch {} })
    $hint = New-Object System.Windows.Controls.TextBlock
    $hint.Text = T 'hint_vlc'
    $hint.Foreground = [System.Windows.Media.Brushes]::DarkGray
    $hint.VerticalAlignment = 'Center'
    [void]$bar.Children.Add($vbtn)
    [void]$bar.Children.Add($hint)
    $script:torWv = New-Object Microsoft.Web.WebView2.Wpf.WebView2
    try { $cp = New-Object Microsoft.Web.WebView2.Wpf.CoreWebView2CreationProperties; $cp.UserDataFolder = (Join-Path $env:TEMP 'ytui_wv2'); $script:torWv.CreationProperties = $cp } catch {}
    [void]$dock.Children.Add($bar)
    [void]$dock.Children.Add($script:torWv)
    $tw.Content = $dock
    $tw.Add_Closed({ try { $script:torWv.Dispose() } catch {}; Stop-Torrent })
    $script:torWv.Source = New-Object System.Uri $url
    $tw.Show(); $tw.Activate()
    $script:torWin = $tw
  }
  catch {
    if ($script:torVlc) { Start-Process $script:torVlc $url } else { Set-State (T 'err_player') '#FF5C5C' }
  }
}

function Install-TorrentEngine {
  # auto-install the engine on first use (requires Node.js + internet)
  $script:torInstalling = $true
  Set-State (T 'st_tor_install') '#8F8F97'
  $bat = "@echo off`r`ncd /d `"$teDir`"`r`nif not exist package.json call npm init -y`r`nif exist node_modules rmdir /s /q node_modules`r`ncall npm install webtorrent@1 --no-optional --no-audit --no-fund`r`n"
  Set-Content -Path $torInstBat -Value $bat -Encoding OEM
  Remove-Item $torInstLog, ($torInstLog + '.err') -ErrorAction SilentlyContinue
  try { $script:torInstProc = Start-Hidden $torInstBat '' $torInstLog ($torInstLog + '.err') }
  catch { $script:torInstalling = $false; Set-State (T 'err_no_node') '#FF5C5C'; return }
  if ($script:torInstTimer) { try { $script:torInstTimer.Stop() } catch {} }
  $script:torInstTimer = New-Object System.Windows.Threading.DispatcherTimer
  $script:torInstTimer.Interval = [TimeSpan]::FromMilliseconds(1000)
  $script:torInstTries = 0
  $script:torInstTimer.Add_Tick({
      $script:torInstTries++
      if (Test-Path $wtDir) {
        $script:torInstTimer.Stop(); $script:torInstalling = $false
        Set-State (T 'st_tor_installed') '#34C759'
        if ($script:torPendingId) { Start-Torrent $script:torPendingId }
      }
      elseif (($script:torInstProc -and $script:torInstProc.HasExited) -or ($script:torInstTries -gt 180)) {
        $script:torInstTimer.Stop(); $script:torInstalling = $false
        $e = ''
        try { if (Test-Path ($torInstLog + '.err')) { $e = [System.IO.File]::ReadAllText($torInstLog + '.err') } } catch {}
        $msg = T 'err_tor_install'
        # npm error text from cmd.exe may be localized (English "not recognized", or the Russian equivalent written as \u escapes)
        if ("$e" -match 'not recognized|\u043D\u0435 \u044F\u0432\u043B\u044F\u0435\u0442\u0441\u044F') { $msg = T 'err_no_node' }
        Set-State $msg '#FF5C5C'
      }
    })
  $script:torInstTimer.Start()
}

function Start-Torrent($id) {
  $qb = Find-Qbittorrent
  if (-not $qb) { Set-State (T 'err_no_qb') '#FF5C5C'; return }
  $vlc = Get-VlcPath
  if (-not $vlc) { Set-State (T 'err_no_vlc') '#FF5C5C'; return }
  Stop-Torrent
  $arg = ''
  if ($id -match '^magnet:') { $arg = $id }
  elseif (Test-Path $id) { $arg = $id }
  else { Set-State (T 'st_not_torrent') '#FFB340'; return }
  # dedicated cache folder for this session (inside the app folder — visible and easy to clean)
  $script:qbSave = Join-Path $root ('torrent-cache\' + (Get-Date -Format 'HHmmss'))
  try { New-Item -ItemType Directory -Force -Path $script:qbSave | Out-Null } catch {}
  $script:torOpened = $false
  $script:torVlcPath = $vlc
  $sp = $script:qbSave
  $script:torStart = Get-Date
  $script:qbDirs = @($sp, (Get-QbDefaultSave)) | Where-Object { $_ } | Select-Object -Unique
  Set-State (T 'st_qb_adding') '#8F8F97'
  try {
    Start-Process -FilePath $qb -ArgumentList @("--save-path=$sp", "--sequential", "--skip-dialog=true", $arg)
  }
  catch { Set-State (T 'err_qb_start') '#FF5C5C'; return }
  Set-State (T 'st_tor_buffering') '#8F8F97'
  if ($script:torWait) { try { $script:torWait.Stop() } catch {} }
  $script:torWait = New-Object System.Windows.Threading.DispatcherTimer
  $script:torWait.Interval = [TimeSpan]::FromMilliseconds(1500)
  $script:torTries = 0
  $script:torWait.Add_Tick({
      $script:torTries++
      try {
        $vid = $script:qbDirs | ForEach-Object { Get-ChildItem -Path $_ -Recurse -File -ErrorAction SilentlyContinue } |
        Where-Object { $_.Extension -match '^\.(mp4|mkv|avi|mov|webm|m4v|flv|wmv|ts|m2ts|mpg|mpeg)$' -and $_.Name -notmatch 'sample' -and $_.LastWriteTime -gt $script:torStart.AddSeconds(-20) } |
        Sort-Object Length -Descending | Select-Object -First 1
        if ($vid -and $vid.Length -gt 5MB -and -not $script:torOpened) {
          $script:torOpened = $true
          $script:torWait.Stop()
          Set-State (T 'st_tor_playing') '#34C759'
          try { Start-Process -FilePath $script:torVlcPath -ArgumentList @('--file-caching=8000', $vid.FullName) }
          catch { try { Start-Process $script:torVlcPath $vid.FullName } catch {} }
        }
        elseif ($script:torTries -gt 100) {
          $script:torWait.Stop()
          Set-State (T 'err_tor_nodata') '#FF5C5C'
        }
      }
      catch {}
    })
  $script:torWait.Start()
}

function Open-VideoWV2($id) {
  try {
    if (-not $script:wvWin -or -not $script:wvWin.IsLoaded) {
      $script:wvWin = New-Object System.Windows.Window
      $script:wvWin.Title = T 'ttl_video'
      $script:wvWin.Width = 980; $script:wvWin.Height = 620
      $script:wvWin.WindowStartupLocation = 'CenterScreen'
      $script:wvWin.Background = [System.Windows.Media.Brushes]::Black
      $script:wv = New-Object Microsoft.Web.WebView2.Wpf.WebView2
      try {
        $cp = New-Object Microsoft.Web.WebView2.Wpf.CoreWebView2CreationProperties
        $cp.UserDataFolder = (Join-Path $env:TEMP 'ytui_wv2')
        $script:wv.CreationProperties = $cp
      }
      catch {}
      $script:wvWin.Content = $script:wv
      $script:wvWin.Add_Closed({ try { $script:wv.Dispose() } catch {} })
    }
    # load the full watch page — it plays ANY video (including embed-restricted ones),
    # unlike /embed/, which yields "Error 153" when opened as a top-level window
    $script:wv.Source = New-Object System.Uri ("https://www.youtube.com/watch?v=$($id)")
    $script:wvWin.Show(); $script:wvWin.Activate()
  }
  catch { Set-State (T 'err_wv2') '#FF5C5C' }
}
function Open-Video {
  $vurl = $(if ($script:lastPreviewUrl) { $script:lastPreviewUrl } else { (@($urlBox.Text -split "[\r\n\s]+" | Where-Object { $_ }))[0] })
  $id = Get-YtId $vurl
  if ($id -and $script:hasWV2) {
    try { $script:mp.Pause() } catch {}
    $script:playing = $false; $playGlyph.Text = [char]0xE768
    Open-VideoWV2 $id
    return
  }
  $hasFile = ($script:lastFile -and (Test-Path $script:lastFile))
  if ($id -and -not $hasFile) {
    Set-State (T 'st_need_wv2') '#FFB340'
    return
  }
  $src = $(if ($hasFile) { $script:lastFile } elseif ($script:streamUrl) { $script:streamUrl } else { '' })
  if (-not $src) { Set-State (T 'st_need_link') '#FFB340'; return }
  try { $script:mp.Pause() } catch {}
  $script:playing = $false; $playGlyph.Text = [char]0xE768
  try {
    if (-not $script:vidWin -or -not $script:vidWin.IsLoaded) {
      [xml]$vx = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="" Width="900" Height="560" Background="#FF0B0B10"
        WindowStartupLocation="CenterScreen" FontFamily="Segoe UI">
  <Grid>
    <Grid.RowDefinitions><RowDefinition Height="*"/><RowDefinition Height="Auto"/></Grid.RowDefinitions>
    <MediaElement x:Name="vme" Grid.Row="0" LoadedBehavior="Manual" Stretch="Uniform"/>
    <Border Grid.Row="1" Background="#FF16161D" Padding="14,9">
      <Grid>
        <Grid.ColumnDefinitions>
          <ColumnDefinition Width="Auto"/><ColumnDefinition Width="Auto"/><ColumnDefinition Width="*"/>
          <ColumnDefinition Width="Auto"/><ColumnDefinition Width="Auto"/><ColumnDefinition Width="Auto"/><ColumnDefinition Width="Auto"/>
        </Grid.ColumnDefinitions>
        <TextBlock x:Name="vplay" Grid.Column="0" Text="&#xE769;" FontFamily="Segoe MDL2 Assets" FontSize="20" Foreground="White" VerticalAlignment="Center" Cursor="Hand" Margin="0,0,16,0"/>
        <TextBlock x:Name="vcur" Grid.Column="1" Text="0:00" Foreground="#CCFFFFFF" FontSize="12" VerticalAlignment="Center" Margin="0,0,10,0"/>
        <Slider x:Name="vseek" Grid.Column="2" Minimum="0" Maximum="1000" Value="0" VerticalAlignment="Center"/>
        <TextBlock x:Name="vtot" Grid.Column="3" Text="0:00" Foreground="#CCFFFFFF" FontSize="12" VerticalAlignment="Center" Margin="10,0,14,0"/>
        <TextBlock Grid.Column="4" Text="&#xE767;" FontFamily="Segoe MDL2 Assets" FontSize="15" Foreground="#CCFFFFFF" VerticalAlignment="Center" Margin="0,0,6,0"/>
        <Slider x:Name="vvol" Grid.Column="5" Minimum="0" Maximum="1" Value="1" Width="90" VerticalAlignment="Center" Margin="0,0,16,0"/>
        <TextBlock x:Name="vfull" Grid.Column="6" Text="&#xE740;" FontFamily="Segoe MDL2 Assets" FontSize="16" Foreground="White" VerticalAlignment="Center" Cursor="Hand"/>
      </Grid>
    </Border>
  </Grid>
</Window>
'@
      $vr = New-Object System.Xml.XmlNodeReader $vx
      $script:vidWin = [Windows.Markup.XamlReader]::Load($vr)
      $script:vidme = $script:vidWin.FindName('vme')
      $script:vplay = $script:vidWin.FindName('vplay')
      $script:vseek = $script:vidWin.FindName('vseek')
      $script:vcur = $script:vidWin.FindName('vcur')
      $script:vtot = $script:vidWin.FindName('vtot')
      $script:vvol = $script:vidWin.FindName('vvol')
      $script:vfull = $script:vidWin.FindName('vfull')
      $vfull = $script:vfull
      $script:vidWin.Title = T 'ttl_video'
      $vfull.ToolTip = T 'tip_fullscreen'
      $script:vdur = 0.0
      $script:vseeking = $false

      $vtoggle = { try { if ($script:vidPlaying) { $script:vidme.Pause(); $script:vidPlaying = $false; $script:vplay.Text = [char]0xE768 } else { $script:vidme.Play(); $script:vidPlaying = $true; $script:vplay.Text = [char]0xE769 } } catch {} }
      $script:vplay.Add_MouseLeftButtonDown($vtoggle)
      $script:vidme.Add_MouseLeftButtonDown($vtoggle)
      $script:vidme.Add_MediaOpened({ try { if ($script:vidme.NaturalDuration.HasTimeSpan) { $script:vdur = $script:vidme.NaturalDuration.TimeSpan.TotalSeconds; $script:vtot.Text = (Format-Time $script:vdur) } } catch {} })
      $script:vidme.Add_MediaEnded({ try { $script:vidme.Position = [TimeSpan]::Zero; $script:vidme.Pause(); $script:vidPlaying = $false; $script:vplay.Text = [char]0xE768 } catch {} })
      $script:vidme.Add_MediaFailed({ try { $script:vidWin.Title = T 'vid_failed' } catch {} })
      $script:vvol.Add_ValueChanged({ try { $script:vidme.Volume = $script:vvol.Value } catch {} })
      $script:vseek.Add_PreviewMouseDown({ $script:vseeking = $true })
      $script:vseek.Add_PreviewMouseUp({ try { if ($script:vdur -gt 0) { $script:vidme.Position = [TimeSpan]::FromSeconds(($script:vseek.Value / 1000.0) * $script:vdur) } } catch {}; $script:vseeking = $false })
      $vfull.Add_MouseLeftButtonDown({ try { if ($script:vidWin.WindowStyle -eq 'None') { $script:vidWin.WindowStyle = 'SingleBorderWindow'; $script:vidWin.WindowState = 'Normal' } else { $script:vidWin.WindowStyle = 'None'; $script:vidWin.WindowState = 'Maximized' } } catch {} })

      $script:vtimer = New-Object System.Windows.Threading.DispatcherTimer
      $script:vtimer.Interval = [TimeSpan]::FromMilliseconds(500)
      $script:vtimer.Add_Tick({ try { if ($script:vidPlaying -and $script:vdur -gt 0 -and -not $script:vseeking) { $script:vseek.Value = ($script:vidme.Position.TotalSeconds / $script:vdur) * 1000; $script:vcur.Text = (Format-Time $script:vidme.Position.TotalSeconds) } } catch {} })
      $script:vtimer.Start()
      $script:vidWin.Add_Closed({ try { $script:vidme.Stop(); $script:vidme.Close() } catch {}; try { $script:vtimer.Stop() } catch {} })
    }
    $script:vidme.Source = New-Object System.Uri $src
    $script:vidme.Play(); $script:vidPlaying = $true
    $script:vplay.Text = [char]0xE769
    $script:vidWin.Show(); $script:vidWin.Activate()
  }
  catch { Set-State (T 'err_video') '#FF5C5C' }
}
$btnPlay.Add_MouseLeftButtonDown({ param($s, $e) $e.Handled = $true; Open-Video })
$btnRew.Add_MouseLeftButtonDown({ param($s, $e) $e.Handled = $true; if ($script:playerSrc) { try { $script:mp.Position = $script:mp.Position.Subtract([TimeSpan]::FromSeconds(10)) } catch {} } })
$btnFf.Add_MouseLeftButtonDown({ param($s, $e) $e.Handled = $true; if ($script:playerSrc) { try { $script:mp.Position = $script:mp.Position.Add([TimeSpan]::FromSeconds(10)) } catch {} } })
$btnPrev.Add_MouseLeftButtonDown({
    param($s, $e)
    $e.Handled = $true
    if (-not $script:playerSrc) { return }
    try {
      $cur = $script:mp.Position.TotalSeconds
      if ($script:chapters.Count -gt 0) {
        $target = 0.0
        foreach ($cs in $script:chapters) { if ($cs -lt ($cur - 1.5)) { $target = $cs } }
        $script:mp.Position = [TimeSpan]::FromSeconds($target)
      }
      else { $script:mp.Position = [TimeSpan]::Zero }
    }
    catch {}
  })
$btnNext.Add_MouseLeftButtonDown({
    param($s, $e)
    $e.Handled = $true
    if (-not $script:playerSrc) { return }
    try {
      $cur = $script:mp.Position.TotalSeconds
      $jumped = $false
      if ($script:chapters.Count -gt 0) {
        foreach ($cs in $script:chapters) {
          if ($cs -gt ($cur + 0.5)) { $script:mp.Position = [TimeSpan]::FromSeconds($cs); $jumped = $true; break }
        }
      }
      if (-not $jumped -and $script:playerDur -gt 0) { $script:mp.Position = [TimeSpan]::FromSeconds([math]::Max(0, $script:playerDur - 3)) }
    }
    catch {}
  })

$playerBar.Add_MouseLeftButtonDown({
    param($s, $e)
    if ($script:playerDur -le 0) { return }
    try {
      $px = $e.GetPosition($playerBar)
      $frac = $px.X / $playerBar.ActualWidth
      if ($frac -lt 0) { $frac = 0 }; if ($frac -gt 1) { $frac = 1 }
      $script:mp.Position = [TimeSpan]::FromSeconds($frac * $script:playerDur)
      $playerBar.Value = $frac * 100
      $curTime.Text = Format-Time ($frac * $script:playerDur)
    }
    catch {}
  })

$trimH1.Add_DragDelta({
    param($s, $e)
    $nl = [System.Windows.Controls.Canvas]::GetLeft($trimH1) + $e.HorizontalChange
    $max = [System.Windows.Controls.Canvas]::GetLeft($trimH2) - 14
    if ($nl -lt 0) { $nl = 0 }
    if ($nl -gt $max) { $nl = $max }
    [System.Windows.Controls.Canvas]::SetLeft($trimH1, $nl)
    Update-TrimFromTrack
  })
$trimH2.Add_DragDelta({
    param($s, $e)
    $nl = [System.Windows.Controls.Canvas]::GetLeft($trimH2) + $e.HorizontalChange
    $min = [System.Windows.Controls.Canvas]::GetLeft($trimH1) + 14
    if ($nl -lt $min) { $nl = $min }
    if ($nl -gt 688) { $nl = 688 }
    [System.Windows.Controls.Canvas]::SetLeft($trimH2, $nl)
    Update-TrimFromTrack
  })

$clearQueueBtn.Add_MouseLeftButtonDown({ param($s, $e) $e.Handled = $true; Clear-WaitingQueue })

# --- chapter picker ---
function Render-Chapters {
  $chaptersList.Children.Clear()
  $selTitles = @($script:selectedChapters | ForEach-Object { $_.Title })
  $n = 0
  foreach ($ch in $script:chapterData) {
    $n++
    $cb = New-Object System.Windows.Controls.CheckBox
    $cb.Style = $window.FindResource('CheckRow')
    $cb.Content = ('{0:d2}  ·  {1} – {2}  ·  {3}' -f $n, (Format-Time $ch.Start), (Format-Time $ch.End), $ch.Title)
    $cb.Tag = $ch
    if ($selTitles -contains $ch.Title) { $cb.IsChecked = $true }
    [void]$chaptersList.Children.Add($cb)
  }
}
function Update-ChaptersBtn {
  $k = @($script:selectedChapters).Count
  if ($k -gt 0) {
    $chaptersBtn.Content = (T 'btn_chapters_sel') -f $k
    $trimLabel.Text = (T 'trim_chapters') -f $k
  }
  else {
    $chaptersBtn.Content = (T 'btn_chapters_n') -f @($script:chapterData).Count
    Update-TrimFromTrack
  }
}
$chaptersBtn.Add_Click({ Render-Chapters; $chaptersOverlay.Visibility = 'Visible' })
$chaptersAllBtn.Add_Click({ foreach ($c in $chaptersList.Children) { $c.IsChecked = $true } })
$chaptersNoneBtn.Add_Click({ foreach ($c in $chaptersList.Children) { $c.IsChecked = $false } })
$chaptersApplyBtn.Add_Click({
    $sel = @()
    foreach ($c in $chaptersList.Children) { if ($c.IsChecked) { $sel += , $c.Tag } }
    $script:selectedChapters = $sel
    $chaptersOverlay.Visibility = 'Collapsed'
    Update-ChaptersBtn
  })
$chaptersCloseBtn.Add_Click({ $chaptersOverlay.Visibility = 'Collapsed' })
$chaptersOverlay.Add_MouseLeftButtonDown({ param($s, $e) if ($e.OriginalSource -eq $chaptersOverlay) { $chaptersOverlay.Visibility = 'Collapsed' } })

$gearBtn.Add_MouseLeftButtonDown({ param($s, $e) $e.Handled = $true; $settingsOverlay.Visibility = 'Visible' })
$settingsClose.Add_Click({ $settingsOverlay.Visibility = 'Collapsed'; Save-Settings })
$settingsOverlay.Add_MouseLeftButtonDown({ param($s, $e) if ($e.OriginalSource -eq $settingsOverlay) { $settingsOverlay.Visibility = 'Collapsed'; Save-Settings } })

$artBtn.Add_MouseLeftButtonDown({ param($s, $e) $e.Handled = $true; Open-Video })
$videoClose.Add_MouseLeftButtonDown({ param($s, $e) $e.Handled = $true; $videoOverlay.Visibility = 'Collapsed' })
$videoOverlay.Add_MouseLeftButtonDown({ param($s, $e) if ($e.OriginalSource -eq $videoOverlay) { $videoOverlay.Visibility = 'Collapsed' } })

$searchBtn.Add_MouseLeftButtonDown({ param($s, $e) $e.Handled = $true; $searchOverlay.Visibility = 'Visible'; $searchBox.Focus() })
$ytLogoBtn.Add_MouseLeftButtonDown({ param($s, $e) $e.Handled = $true; $searchOverlay.Visibility = 'Visible'; $searchBox.Focus() })
$searchCloseBtn.Add_Click({ $searchOverlay.Visibility = 'Collapsed' })
$searchOverlay.Add_MouseLeftButtonDown({ param($s, $e) if ($e.OriginalSource -eq $searchOverlay) { $searchOverlay.Visibility = 'Collapsed' } })
$searchGo.Add_Click({ Run-Search })
$searchBox.Add_KeyDown({ param($s, $e) if ($e.Key -eq 'Return') { Run-Search; $e.Handled = $true } })

function Start-Download {
  if ($script:queueActive -or $script:proc) { Set-State (T 'st_busy') '#FFB340'; return }
  $urls = @($urlBox.Text -split "[\r\n\s]+" |
    ForEach-Object { $_.Trim() } |
    Where-Object { $_ } |
    ForEach-Object {
      if ($_ -match '^https?://') { $_ }
      elseif ($_ -match '^[\w-]+\.[\w-]+') { "https://$_" }
      else { $null }
    } |
    Where-Object { $_ })
  if ($urls.Count -eq 0) { Set-State (T 'st_paste_link') '#FF5C5C'; return }
  $folder = $folderBox.Text.Trim()
  if (-not $folder) { $folder = $defaultFolder; $folderBox.Text = $folder }
  if (-not (Test-Path $folder)) {
    try { New-Item -ItemType Directory -Path $folder -Force | Out-Null }
    catch { Set-State (T 'err_folder') '#FF5C5C'; return }
  }

  # cookies check (once)
  $cIdx = Get-Sel $cookiesPanel
  if ($cIdx -eq 1) {
    $cookiesFile = Join-Path $root 'cookies.txt'
    if (-not (Test-Path $cookiesFile)) {
      $alt = Join-Path $root 'cookies.txt.txt'
      if (Test-Path $alt) { Move-Item -Path $alt -Destination $cookiesFile -Force }
    }
    if (-not (Test-Path $cookiesFile)) { Set-State (T 'err_no_cookies') '#FF5C5C'; return }
  }

  Save-Settings
  $script:dlFolder = $folder
  Build-QueueList $urls
  $script:queueTotal = $script:queueItems.Count
  $script:queueOk = 0
  $script:queueFail = 0
  $script:workers.Clear()
  $script:cancelled = $false
  $script:sawSuccess = $false
  $script:cookieStale = $false
  $script:cookieBrowserFail = $false
  $script:lastFile = ''
  $script:lastAggPct = -1.0
  [void]$script:logBuffer.Clear()
  $openFileBtn.Visibility = 'Collapsed'
  try { $script:mp.Stop() } catch {}
  $script:playing = $false
  $script:playerSrc = ''
  $playGlyph.Text = [char]0xE768; $playerBar.Value = 0; $curTime.Text = '0:00'
  $previewCard.Visibility = 'Collapsed'
  $itemTitle.Text = ''; $detailText.Text = ''
  $itemTitle.Visibility = 'Collapsed'
  $progress.Visibility = 'Visible'
  $detailText.Visibility = 'Visible'
  Reset-Progress
  Set-State (T 'st_preparing') '#8F8F97'
  Set-Busy $true
  $script:queueActive = $true
  $maxPar = [math]::Min((Get-Sel $parallelPanel) + 1, $script:queueTotal)
  for ($k = 0; $k -lt $maxPar; $k++) { Start-NextWorker }
}

$downloadBtn.Add_Click({ Start-Download })

$cancelBtn.Add_Click({
    if (($script:proc -and -not $script:proc.HasExited) -or $script:workers.Count -gt 0) {
      $script:cancelled = $true
      if ($script:proc -and -not $script:proc.HasExited) { Kill-Tree $script:proc.Id -Wait }
      foreach ($w in $script:workers.ToArray()) {
        if ($w.Proc -and -not $w.Proc.HasExited) { Kill-Tree $w.Proc.Id }
      }
    }
  })

$updateBtn.Add_Click({ Start-YtDlp '-U' (T 'st_updating') 'update' })

$titleBar.Add_MouseLeftButtonDown({ try { $window.DragMove() } catch {} })
$dotClose.Add_MouseLeftButtonDown({ param($s, $e) $e.Handled = $true; $window.Close() })
$dotMin.Add_MouseLeftButtonDown({ param($s, $e) $e.Handled = $true; $window.WindowState = 'Minimized' })

# tray
if ($script:notify) {
  try {
    $script:trayMenu = New-Object System.Windows.Forms.ContextMenuStrip
    $script:miOpen = $script:trayMenu.Items.Add((T 'tray_open'))
    $script:miExit = $script:trayMenu.Items.Add((T 'tray_exit'))
    $miOpen = $script:miOpen; $miExit = $script:miExit
    $miOpen.add_Click({ $window.Dispatcher.Invoke([action] { $window.Show(); $window.WindowState = 'Normal'; $window.Activate(); $script:notify.Visible = $false }) })
    $miExit.add_Click({ $window.Dispatcher.Invoke([action] { $window.Close() }) })
    $script:notify.ContextMenuStrip = $script:trayMenu
    $script:notify.add_MouseClick({
        param($s, $e)
        if ($e.Button -eq [System.Windows.Forms.MouseButtons]::Left) {
          $window.Dispatcher.Invoke([action] { $window.Show(); $window.WindowState = 'Normal'; $window.Activate(); $script:notify.Visible = $false })
        }
      })
  }
  catch {}
}
$window.Add_StateChanged({
    if ($window.WindowState -eq 'Minimized' -and $script:notify) {
      try { $window.Hide(); $script:notify.Visible = $true } catch {}
    }
  })

$window.Add_Closing({
    if ($script:proc -and -not $script:proc.HasExited) {
      Kill-Tree $script:proc.Id
    }
    foreach ($w in $script:workers.ToArray()) {
      if ($w.Proc -and -not $w.Proc.HasExited) { Kill-Tree $w.Proc.Id }
    }
    if ($script:notify) { try { $script:notify.Visible = $false; $script:notify.Dispose() } catch {} }
    if ($script:vidWin) { try { $script:vidWin.Close() } catch {} }
    if ($script:wvWin) { try { $script:wvWin.Close() } catch {} }
    if ($script:torWin) { try { $script:torWin.Close() } catch {} }
    Stop-Torrent
    Save-Settings
  })

$window.Add_KeyDown({
    param($s, $e)
    if ($e.Key -eq 'Escape') {
      $settingsOverlay.Visibility = 'Collapsed'
      $historyOverlay.Visibility = 'Collapsed'
      $searchOverlay.Visibility = 'Collapsed'
      $videoOverlay.Visibility = 'Collapsed'
      $chaptersOverlay.Visibility = 'Collapsed'
      $previewCard.Visibility = 'Collapsed'
      Save-Settings
      $e.Handled = $true
      return
    }
    if ([System.Windows.Input.Keyboard]::Modifiers -eq [System.Windows.Input.ModifierKeys]::Control) {
      if ($e.Key -eq 'H') {
        if ($historyOverlay.Visibility -eq 'Visible') { $historyOverlay.Visibility = 'Collapsed' }
        else { Render-History $historySearchBox.Text.Trim(); $historyOverlay.Visibility = 'Visible' }
        $e.Handled = $true
        return
      }
      if ($e.Key -eq 'F') {
        if ($searchOverlay.Visibility -eq 'Visible') { $searchOverlay.Visibility = 'Collapsed' }
        else { $searchOverlay.Visibility = 'Visible'; $searchBox.Focus() }
        $e.Handled = $true
        return
      }
      if ($e.Key -eq 'OemComma') {
        if ($settingsOverlay.Visibility -eq 'Visible') { $settingsOverlay.Visibility = 'Collapsed'; Save-Settings }
        else { $settingsOverlay.Visibility = 'Visible' }
        $e.Handled = $true
        return
      }
    }
    if ($e.Key -eq 'Space' -and -not $urlBox.IsKeyboardFocused -and -not $searchBox.IsKeyboardFocused) {
      Open-Video
      $e.Handled = $true
    }
  })

$window.Add_Loaded({
    $urlBox.Focus()
    Update-TrimFromTrack
    Set-WinHeight $script:hBase
    try {
      $script:hwnd = (New-Object System.Windows.Interop.WindowInteropHelper $window).Handle
      [Win32.Acrylic]::Apply($script:hwnd, 0x55110E0E)
      Apply-Transparency $opacitySlider.Value
    }
    catch {}

    # silent background yt-dlp update check every 3 days
    try {
      $lastCheckFile = Join-Path $root 'last-update-check.tmp'
      $shouldCheck = $true
      if (Test-Path $lastCheckFile) {
        $lastTime = (Get-Item $lastCheckFile).LastWriteTime
        if ((Get-Date) - $lastTime -lt (New-TimeSpan -Days 3)) { $shouldCheck = $false }
      }
      if ($shouldCheck) {
        Set-Content -Path $lastCheckFile -Value (Get-Date).ToString() -Encoding UTF8
        [System.Threading.Tasks.Task]::Run([Action] {
            try {
              $psi = New-Object System.Diagnostics.ProcessStartInfo
              $psi.FileName = $ytdlp
              $psi.Arguments = '-U'
              $psi.CreateNoWindow = $true
              $psi.UseShellExecute = $false
              [System.Diagnostics.Process]::Start($psi) | Out-Null
            }
            catch {}
          }) | Out-Null
      }
    }
    catch {}
  })
$opacitySlider.Add_ValueChanged({ Apply-Transparency $opacitySlider.Value })
[void]$window.ShowDialog()
