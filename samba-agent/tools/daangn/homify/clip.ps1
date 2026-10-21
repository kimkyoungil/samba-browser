param([string]$path)
Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Image]::FromFile($path); [System.Windows.Forms.Clipboard]::SetImage($img); "ok"
