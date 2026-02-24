@echo off
:: ── SSH Reverse Tunnel — PC Bridge to VPS ───────────
:: Keeps a persistent SSH tunnel from PC to VPS.
:: PC Bridge (localhost:3847) becomes accessible on VPS at localhost:3847.
:: Auto-reconnects if connection drops.

:loop
echo [%date% %time%] Connecting SSH tunnel to VPS... >> "%~dp0tunnel.log"

gcloud compute ssh gravity-claw --project=bot-servers-487322 --zone=europe-west1-b -- -R 3847:localhost:3847 -N -o "ServerAliveInterval=30" -o "ServerAliveCountMax=3" -o "ExitOnForwardFailure=yes"

echo [%date% %time%] SSH tunnel disconnected. Reconnecting in 5s... >> "%~dp0tunnel.log"
timeout /t 5 /nobreak >NUL
goto loop
