# Linux 打包(CI)

`Package Linux` 工作流(`.github/workflows/package-linux.yml`)在仓库从上游同步
(push 到 main)后自动编译并产出全部 Linux 发行版格式,也可在 Actions 页手动触发。

## 产物(均 x86_64 / amd64)

| 格式 | 文件名 | 安装方式 |
|---|---|---|
| 便携 tar.gz | `Kivio_<ver>_linux_x64.tar.gz` | 解压后 `./kivio/kivio` |
| Debian/Ubuntu | `kivio-desktop_<ver>_amd64.deb` | `sudo apt install ./kivio-desktop_<ver>_amd64.deb` |
| Arch/Manjaro | `kivio-desktop-<ver>-1-x86_64.pkg.tar.zst` | `sudo pacman -U kivio-desktop-<ver>-1-x86_64.pkg.tar.zst` |
| AppImage | `kivio-desktop-<ver>-x86_64.AppImage` | `chmod +x` 后直接运行 |
| NixOS 二进制包 | `kivio-desktop-bin-<ver>-nix/`(closure 导出 + derivation) | 见产物内 README.md |
| 源码包 | `kivio-desktop-<ver>.tar.gz` | `git archive` 生成,仅含被跟踪文件 |

## 布局约定

系统包装(deb / Arch / Nix)统一安装到 `/opt/kivio-desktop/`(Nix 为
`$out/opt/kivio-desktop/`),内容 = `kivio` 主二进制 + `skills/` 文档技能资源
+ `kivio-ocr-helper` 占位 stub。Tauri 资源路径按 "exe 所在目录" 解析,
因此二进制与 `skills/` 必须同目录。

前端资源由 Tauri 编译期嵌入二进制(`frontendDist`),无需随包分发——这一点与
rikkahub-desktop(二进制 + web-ui/build/client 同目录)不同。

命令统一为 `kivio-desktop`(`ci/linux/launcher.sh` 生成)。
数据目录由 Tauri 管理,默认落 `~/.local/share/com.zmair.kivio`。

AppImage 为只读 squashfs,二进制与资源平铺在 AppDir 根;`AppRun` 由
`ci/linux/appimage-apprun.sh` 生成。

## 文件

- `kivio-desktop.desktop` — freedesktop 菜单项
- `launcher.sh` — 系统安装启动器(Nix derivation 会 sed 替换安装路径)
- `appimage-apprun.sh` — AppImage AppRun

hicolor 图标在 CI 中由 `src-tauri/icons/icon.png` 现场缩放生成(32/48/64/128/256)。

## 运行时依赖

与自包含单文件二进制不同,Kivio Desktop 是 Tauri(WebKit)应用:系统包装需要
`libwebkit2gtk-4.1` / `libgtk-3` / `librsvg2` 等运行库(deb 的 Depends 字段已声明,
Arch 见 .PKGINFO 的 depend 行)。AppImage 暂不内置这些系统库,目标机需已安装。

OCR sidecar(`kivio-ocr-helper`)仅 macOS 有真实实现,Linux 下是空 stub,
运行时按平台禁用、不会被 spawn,随包分发只为保持 Tauri externalBin 布局完整。
