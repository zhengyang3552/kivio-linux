#!/bin/sh
# Kivio Desktop 启动器(系统安装:deb / Arch / Nix 共用)
# 二进制与 skills/ 资源位于 /opt/kivio-desktop(Tauri 资源路径按 exe 所在目录解析,两者必须同目录)。
# 数据目录由 Tauri 管理,默认落 ~/.local/share/com.zmair.kivio,无需在此注入环境变量。
exec /opt/kivio-desktop/kivio "$@"
