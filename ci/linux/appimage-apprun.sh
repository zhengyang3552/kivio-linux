#!/bin/sh
# AppImage 入口 AppRun:kivio 二进制与 skills/ 资源平铺在 AppDir 根(与 AppRun 同层),
# Tauri 资源路径按 "exe 所在目录" 解析,两者必须同层。
HERE="$(dirname "$(readlink -f "$0")")"
exec "$HERE/kivio" "$@"
