# Offline preview of the four Entry Diagnostic V2 listening clips.
#
# Uses the Windows built-in en-US voices (System.Speech: Microsoft Zira =
# female, Microsoft David = male) - no network call, no provider account, no
# cost. Text comes verbatim from the approved scripts in
# artifacts/entry-diagnostic-v2-content-draft.json, cast as approved:
#   CLIP_01 A female, B male | CLIP_02 male | CLIP_03 female | CLIP_04 A male, B female
# Output (WAV, then MP3 via ffmpeg-static) goes to
# artifacts/entry-diagnostic-v2-audio-preview-offline/ for the owner to review.
# Nothing is uploaded and no database row is touched.
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Out = Join-Path $Root 'artifacts\entry-diagnostic-v2-audio-preview-offline'
New-Item -ItemType Directory -Force $Out | Out-Null
Add-Type -AssemblyName System.Speech

$casting = @{
  LST_CLIP_01 = @{ A = 'Microsoft Zira Desktop'; B = 'Microsoft David Desktop' }
  LST_CLIP_02 = @{ NARRATOR = 'Microsoft David Desktop' }
  LST_CLIP_03 = @{ NARRATOR = 'Microsoft Zira Desktop' }
  LST_CLIP_04 = @{ A = 'Microsoft David Desktop'; B = 'Microsoft Zira Desktop' }
}

$draft = Get-Content (Join-Path $Root 'artifacts\entry-diagnostic-v2-content-draft.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$ffmpeg = (& node -e "process.stdout.write(require('ffmpeg-static'))")
$manifest = @()

foreach ($clip in $draft.listening.clips) {
  $key = $clip.draftKey
  $lines = @($clip.script -split "`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ })
  $dialogue = @($lines | Where-Object { $_ -notmatch '^[AB]:\s' }).Count -eq 0
  $turns = if ($dialogue) {
    $lines | ForEach-Object { [pscustomobject]@{ Speaker = $_.Substring(0, 1); Text = $_.Substring(3).Trim() } }
  } else {
    ,[pscustomobject]@{ Speaker = 'NARRATOR'; Text = ($lines -join ' ') }
  }
  $body = ''
  $i = 0
  foreach ($t in $turns) {
    $voice = $casting[$key][$t.Speaker]
    if (-not $voice) { throw "${key}: no voice cast for speaker $($t.Speaker)" }
    $pause = if ($i -gt 0) { '<break time="450ms"/>' } else { '' }
    $body += "<voice name=`"$voice`">$pause$([Security.SecurityElement]::Escape($t.Text))</voice>"
    $i++
  }
  $ssml = "<speak version=`"1.0`" xml:lang=`"en-US`" xmlns=`"http://www.w3.org/2001/10/synthesis`">$body</speak>"
  $wav = Join-Path $Out "$key.preview.wav"
  $mp3 = Join-Path $Out "$key.preview.mp3"
  $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
  $synth.Rate = -1
  $synth.SetOutputToWaveFile($wav)
  $synth.SpeakSsml($ssml)
  $synth.Dispose()
  & $ffmpeg -hide_banner -loglevel error -y -i $wav -ac 1 -ar 24000 -b:a 96k $mp3
  $sha = (Get-FileHash $mp3 -Algorithm SHA256).Hash.ToLower()
  $manifest += [pscustomobject]@{
    clipKey = $key; file = "artifacts/entry-diagnostic-v2-audio-preview-offline/$key.preview.mp3"
    bytes = (Get-Item $mp3).Length; audioSha256 = $sha
    turns = @($turns).Count; casting = $casting[$key]; engine = 'System.Speech (offline, Windows built-in voices)'
  }
  "$key : $(@($turns).Count) turn(s) -> $mp3"
}
$manifest | ConvertTo-Json -Depth 4 | Out-File (Join-Path $Out 'manifest.json') -Encoding utf8
