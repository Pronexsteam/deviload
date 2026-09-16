# Checks Explain-Error (YT-Downloader.ps1) against sample yt-dlp / ffmpeg log snippets.
# Run: powershell -NoProfile -File tests\errors.ps1   (exit code 0 = all cases pass)
$ErrorActionPreference = 'Stop'
$script = Join-Path (Split-Path $PSScriptRoot -Parent) 'YT-Downloader.ps1'

# pull the function out of the app script without running the UI
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($script, [ref]$tokens, [ref]$errors)
if ($errors.Count) { $errors | ForEach-Object { Write-Host $_.ToString() }; exit 1 }
$fn = $ast.Find({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Explain-Error' }, $true)
if (-not $fn) { Write-Host 'Explain-Error not found'; exit 1 }
Invoke-Expression $fn.Extent.Text

$cases = @(
    @{ log = "ERROR: [youtube] jNQXAC9IVRw: n challenge solving failed: Some formats may be missing. JS runtimes: none"; key = 'err_nodeno'; hint = 'err_nodeno_hint' },
    @{ log = "WARNING: [youtube] Signature solving failed: JS runtimes: none`nERROR: Requested format is not available"; key = 'err_nodeno'; hint = 'err_nodeno_hint' },
    @{ log = "ERROR: [youtube] dQw4w9WgXcQ: Sign in to confirm you're not a bot. Use --cookies-from-browser or --cookies"; key = 'err_botcheck'; hint = 'err_botcheck_hint' },
    @{ log = "ERROR: [youtube] dQw4w9WgXcQ: Sign in to confirm you're not a bot."; signedIn = $true; key = 'err_botcheck'; hint = 'err_botcheck_hint2' },
    @{ log = "ERROR: [youtube] abc: Sign in to confirm your age. This video may be inappropriate for some users."; key = 'err_age'; hint = 'err_age_hint' },
    @{ log = "ERROR: [youtube] abc: Private video. Sign in if you've been granted access to this video"; key = 'err_private'; hint = 'err_private_hint' },
    @{ log = "ERROR: [youtube] abc: Join this channel to get access to members-only content like this video, and other exclusive perks."; key = 'err_members'; hint = 'err_members_hint' },
    @{ log = "ERROR: [youtube] abc: The uploader has not made this video available in your country"; key = 'err_geo'; hint = 'err_geo_hint' },
    @{ log = "ERROR: [youtube] aaaaaaaaaaa: Video unavailable"; key = 'err_gone'; hint = 'err_gone_hint' },
    @{ log = "WARNING: [youtube] unable to extract yt initial data; please report this issue`r`nERROR: [youtube] aaaaaaaaaaa: This video is unavailable"; key = 'err_gone'; hint = 'err_gone_hint' },
    @{ log = "ERROR: unable to download video data: HTTP Error 429: Too Many Requests"; key = 'err_ratelimit'; hint = 'err_ratelimit_hint' },
    @{ log = "ERROR: Postprocessing: ffprobe and ffmpeg not found. Please install or provide the path using --ffmpeg-location"; key = 'err_noffmpeg'; hint = 'err_noffmpeg_hint' },
    @{ log = "ERROR: [youtube] abc: Requested format is not available. Use --list-formats for a list of available formats"; key = 'err_format'; hint = 'err_format_hint' },
    @{ log = "ERROR: Unsupported URL: https://example.com/page"; key = 'err_unsupported'; hint = 'err_unsupported_hint' },
    @{ log = "ERROR: unable to download video data: <urlopen error [WinError 10054] An existing connection was forcibly closed by the remote host>"; key = 'err_network'; hint = 'err_network_hint' },
    @{ log = "[download] Destination: video.mp4`n[download] 100% of 1.00MiB"; key = $null; hint = $null }
)

$fail = 0
foreach ($c in $cases) {
    $signedIn = [bool]$c.signedIn
    $r = Explain-Error $c.log $signedIn
    $gotKey = $(if ($r) { $r.key } else { $null })
    $gotHint = $(if ($r) { $r.hint } else { $null })
    $ok = ($gotKey -eq $c.key) -and ($gotHint -eq $c.hint)
    $first = ($c.log -split "`n")[0]
    if ($first.Length -gt 70) { $first = $first.Substring(0, 70) + '...' }
    Write-Host ("  {0}  {1,-18} {2}" -f $(if ($ok) { 'ok  ' } else { 'FAIL' }), $(if ($c.key) { $c.key } else { '(none)' }), $first)
    if (-not $ok) { Write-Host ("        expected {0}/{1}, got {2}/{3}" -f $c.key, $c.hint, $gotKey, $gotHint); $fail++ }
}
Write-Host ("{0} of {1} cases passed" -f ($cases.Count - $fail), $cases.Count)
if ($fail) { exit 1 }
exit 0
