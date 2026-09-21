# 在 Windows 上开一条到 VPS 的加密隧道，浏览器访问 http://127.0.0.1:3000 即可。
# 用法（在本机 PowerShell 里）：
#     powershell -ExecutionPolicy Bypass -File scripts\tunnel.ps1
# 想换服务器：先设环境变量 BB_SERVER，例如 $env:BB_SERVER='root@1.2.3.4'
# 保持这个窗口开着；关窗口或 Ctrl+C 就断开（网站数据不受影响）。
$Server = $env:BB_SERVER
if (-not $Server) { $Server = 'root@188.166.250.14' }
$Port = if ($env:BB_PORT) { $env:BB_PORT } else { 3000 }

Write-Host ""
Write-Host "  隧道路由: 本机 127.0.0.1:$Port  ->  $Server :127.0.0.1:$Port"
Write-Host "  保持本窗口打开，浏览器访问:  http://127.0.0.1:$Port"
Write-Host "  退出: Ctrl+C"
Write-Host ""

ssh -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 `
    -L "${Port}:127.0.0.1:${Port}" $Server
