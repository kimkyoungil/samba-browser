# 클립보드 감시 — 폰에서 복사한 API 키(sk-ant-api...)가 PC 클립보드로 넘어오면 .env 에 저장한다(키는 화면·로그에 남기지 않는다)
$envPath = Join-Path $PSScriptRoot '.env'
$log = Join-Path $env:TEMP 'anthropic-key-watch.log'
Add-Type -AssemblyName PresentationCore
Set-Content $log ('감시 시작 ' + (Get-Date -Format 'HH:mm:ss')) -Encoding UTF8
$end = (Get-Date).AddMinutes(20)
while ((Get-Date) -lt $end) {
  $clip = ''
  try { $clip = [Windows.Clipboard]::GetText() } catch { $clip = '' }
  if ($clip) {
    $t = $clip.Trim()
    if ($t -match '^sk-ant-(api|usr)[0-9A-Za-z_-]{20,}$') {
      $name = 'SAMBA_ANTHROPIC_API_KEY='
      $lines = @(Get-Content $envPath -Encoding UTF8 | Where-Object { $_ -notlike "$name*" })
      $lines += $name + $t
      [IO.File]::WriteAllLines($envPath, $lines, (New-Object Text.UTF8Encoding($false)))
      try { [Windows.Clipboard]::Clear() } catch { }
      Add-Content $log ('저장 완료 ' + (Get-Date -Format 'HH:mm:ss') + ' (길이 ' + $t.Length + ')') -Encoding UTF8
      exit 0
    } elseif ($t -match '^sk-ant-oat') {
      Add-Content $log ('API 키 형식이 아닌 sk-ant- 값을 봤다(접두어 ' + $t.Substring(0, [Math]::Min(11, $t.Length)) + ') — 무시') -Encoding UTF8
      Start-Sleep -Seconds 5
    }
  }
  Start-Sleep -Milliseconds 800
}
Add-Content $log '시간 초과 — 20분 안에 키가 클립보드로 오지 않음' -Encoding UTF8
