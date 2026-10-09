# 하네스 Console API 키 등록 — 키는 화면에 보이지 않게 입력하고 .env 에만 저장한다(채팅에 붙여 넣지 않는다)
$envPath = Join-Path $PSScriptRoot '.env'
Write-Host ''
Write-Host 'Console 에서 만든 API 키(sk-ant-api...)를 붙여 넣고 Enter. 입력은 화면에 보이지 않습니다.' -ForegroundColor Cyan
$sec = Read-Host -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
$key = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
if ($key -notmatch '^sk-ant-(api|usr)[0-9A-Za-z_-]{20,}$') {
  Write-Host 'API 키 형식이 아닙니다(sk-ant-api / sk-ant-usr 로 시작해야 함). 저장하지 않았습니다.' -ForegroundColor Red
  exit 1
}
$name = 'SAMBA_ANTHROPIC_API_KEY='
$lines = @(Get-Content $envPath -Encoding UTF8 | Where-Object { $_ -notlike "$name*" })
$lines += $name + $key
[IO.File]::WriteAllLines($envPath, $lines, (New-Object Text.UTF8Encoding($false)))
Write-Host '저장했습니다. 하네스를 재시작하면 적용됩니다.' -ForegroundColor Green
