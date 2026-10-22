#!/bin/bash
# 双击这个文件即可在本地运行「不许坐着」
cd "$(dirname "$0")" || exit 1

PORT=8124
while lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; do
  PORT=$((PORT + 1))
  if [ "$PORT" -gt 8200 ]; then
    echo "找不到可用端口"
    exit 1
  fi
done

clear
echo ""
echo "  不许坐着 · 关不掉的运动闹钟"
echo "  ─────────────────────────────"
echo "  浏览器地址：http://127.0.0.1:$PORT"
echo "  停止服务：Ctrl + C"
echo ""

( sleep 1.2; open "http://127.0.0.1:$PORT" ) &

if command -v node >/dev/null 2>&1; then
  exec node serve.js "$PORT"
elif [ -x "/Users/gclhaha/.workbuddy/binaries/node/versions/22.22.2-6/bin/node" ]; then
  exec "/Users/gclhaha/.workbuddy/binaries/node/versions/22.22.2-6/bin/node" serve.js "$PORT"
else
  exec python3 -m http.server "$PORT" --bind 127.0.0.1
fi
