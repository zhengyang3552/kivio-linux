# kivio-desktop-bin — NixOS 二进制包 derivation
#
# 包装官方预编译 Linux tar.gz(Kivio_<ver>_linux_x64.tar.gz):
#   $out/opt/kivio-desktop/  kivio 二进制 + skills/ 资源 + OCR sidecar stub
#   $out/bin/kivio-desktop   启动器,数据目录由 Tauri 管理(~/.local/share/com.zmair.kivio)
#
# CI 用法(本地 src,见 .github/workflows/package-linux.yml):
#   nix-build -E 'let pkgs = import <nixpkgs> {};
#     in pkgs.callPackage ./ci/nix/kivio-desktop-bin.nix { version = "2.8.9"; src = ./Kivio_2.8.9_linux_x64.tar.gz; }'
#
# 从 Release 资产构建:
#   nix-build -E '(import <nixpkgs> {}).callPackage ./kivio-desktop-bin.nix {
#     version = "2.8.9"; sha256 = "<Kivio_2.8.9_linux_x64.tar.gz 的 sha256>"; }'
{ lib
, stdenvNoCC
, fetchurl
, version ? "2.8.9"
, sha256 ? lib.fakeHash
, src ? null
}:
let
  remoteSrc = fetchurl {
    url = "https://github.com/zhengyang3552/kivio-linux/releases/download/v${version}/Kivio_${version}_linux_x64.tar.gz";
    inherit sha256;
  };
in
stdenvNoCC.mkDerivation {
  pname = "kivio-desktop-bin";
  inherit version;

  src = if src != null then src else remoteSrc;

  dontConfigure = true;
  dontBuild = true;

  installPhase = ''
    runHook preInstall

    mkdir -p "$out/opt/kivio-desktop" "$out/bin" "$out/share/applications" \
      "$out/share/icons/hicolor/192x192/apps"
    # tarball 仅含 kivio/ 单顶层目录时,unpackPhase 会将其设为 sourceRoot
    # 并已 cd 进去;布局变化(多顶层条目)时回退当前目录
    SRC=.
    if [ -d kivio ]; then SRC=kivio; fi
    cp -r "$SRC/." "$out/opt/kivio-desktop/"

    # launcher.sh 中 /opt/kivio-desktop 替换为本 store 路径
    sed "s|/opt/kivio-desktop|$out/opt/kivio-desktop|g" \
      ${../linux/launcher.sh} > "$out/bin/kivio-desktop"
    chmod 755 "$out/bin/kivio-desktop"

    install -m644 ${../linux/kivio-desktop.desktop} \
      "$out/share/applications/kivio-desktop.desktop"
    install -m644 ${../../src-tauri/icons/icon.png} \
      "$out/share/icons/hicolor/192x192/apps/kivio-desktop.png"

    runHook postInstall
  '';

  meta = with lib; {
    description = "Kivio Desktop — screen-level AI assistant (prebuilt Linux binary)";
    longDescription = ''
      Screen-level AI assistant built with Tauri. Packages the main binary with
      the skills resources; the frontend is embedded in the binary. The OCR
      sidecar is a stub on Linux and disabled at runtime.
      Data directory: ~/.local/share/com.zmair.kivio (managed by Tauri).
    '';
    homepage = "https://github.com/zhengyang3552/kivio-linux";
    license = licenses.gpl3Plus;
    platforms = [ "x86_64-linux" ];
    mainProgram = "kivio-desktop";
  };
}
