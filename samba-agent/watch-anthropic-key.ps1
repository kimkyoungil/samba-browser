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
      $all = @(Get-Content $envPath -Encoding UTF8)
      # 이미 저장된 키와 같으면 무시하고, 새 키면 비어 있는 첫 칸(키, _2, _3)에 넣는다
      $names = @('SAMBA_ANTHROPIC_API_KEY=', 'SAMBA_ANTHROPIC_API_KEY_2=', 'SAMBA_ANTHROPIC_API_KEY_3=')
      $dup = $false
      foreach ($n in $names) { foreach ($l in $all) { if ($l -eq ($n + $t)) { $dup = $true } } }
      if ($dup) { Start-Sleep -Seconds 3; continue }
      $slot = $null
      foreach ($n in $names) { if (-not ($all | Where-Object { $_ -like "$n*" })) { $slot = $n; break } }
      if (-not $slot) { Add-Content $log '빈 키 칸이 없음(3개 사용 중)' -Encoding UTF8; exit 1 }
      $all += $slot + $t
      [IO.File]::WriteAllLines($envPath, $all, (New-Object Text.UTF8Encoding($false)))
      $t = $null
      try { [Windows.Clipboard]::Clear() } catch { }
      Add-Content $log ('저장 완료 ' + (Get-Date -Format 'HH:mm:ss') + ' → ' + $slot.TrimEnd('=')) -Encoding UTF8
      exit 0
    } elseif ($t -match '^sk-ant-oat') {
      Add-Content $log ('API 키 형식이 아닌 sk-ant- 값을 봤다(접두어 ' + $t.Substring(0, [Math]::Min(11, $t.Length)) + ') — 무시') -Encoding UTF8
      Start-Sleep -Seconds 5
    }
  }
  Start-Sleep -Milliseconds 800
}
Add-Content $log '시간 초과 — 20분 안에 키가 클립보드로 오지 않음' -Encoding UTF8
