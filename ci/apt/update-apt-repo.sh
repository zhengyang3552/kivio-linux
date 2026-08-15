#!/usr/bin/env bash
set -euo pipefail

# 更新 apt 源索引(flat 布局,文件在仓库根目录,由 GitHub Pages 托管)。
# .deb 本体不入库——Packages 的 Filename 直接指向 GitHub Release 资产 URL,
# apt 客户端跟随重定向下载,Pages 上只有几 KB 索引。
#
# 用法: update-apt-repo.sh <deb路径> <tag> <owner/name>
# 在索引所在目录(仓库根)运行,原地更新:
#   Packages / Packages.gz / Release / Release.gpg / InRelease
#
# 依赖: dpkg-deb, gzip, sha256sum, apt-ftparchive(apt-utils), gpg
# 签名使用本机 keyring 中的第一把私钥(CI 里先 gpg --import Secret 里的私钥)。

[ $# -eq 3 ] || { echo "用法: $0 <deb路径> <tag> <owner/name>" >&2; exit 1; }
DEB="$1"; TAG="$2"; REPO="$3"

[ -f "$DEB" ] || { echo "找不到 deb: $DEB" >&2; exit 1; }
command -v dpkg-deb        >/dev/null || { echo "缺少 dpkg-deb" >&2; exit 1; }
command -v apt-ftparchive  >/dev/null || { echo "缺少 apt-ftparchive(apt-utils)" >&2; exit 1; }

KEYID="$(gpg --list-secret-keys --with-colons 2>/dev/null | awk -F: '$1=="sec"{print $5; exit}')"
[ -n "$KEYID" ] || { echo "keyring 中没有 GPG 私钥,无法签名" >&2; exit 1; }

BASE="https://github.com/${REPO}/releases/download/${TAG}"
DEBNAME="$(basename "$DEB")"
SIZE="$(stat -c%s "$DEB")"
SHA256="$(sha256sum "$DEB" | cut -d' ' -f1)"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# 1) 新 deb 的单条 Packages 记录 = control 字段原文 + Filename/Size/SHA256
{
  dpkg-deb --field "$DEB"
  echo "Filename: ${BASE}/${DEBNAME}"
  echo "Size: ${SIZE}"
  echo "SHA256: ${SHA256}"
} > "$TMP/new-entry"

NEWPKG="$(awk '/^Package:/{print $2; exit}' "$TMP/new-entry")"
NEWVER="$(awk '/^Version:/{print $2; exit}' "$TMP/new-entry")"
[ -n "$NEWPKG" ] && [ -n "$NEWVER" ] || { echo "deb 控制字段缺 Package/Version" >&2; exit 1; }

# 2) 与既有 Packages 合并:删掉同 Package+Version 的旧记录(重复发布/重传资产场景)
if [ -f Packages ]; then
  awk -v pkg="$NEWPKG" -v ver="$NEWVER" '
    BEGIN { RS=""; ORS="\n\n" }
    {
      n = split($0, L, "\n"); hitP = 0; hitV = 0
      for (i = 1; i <= n; i++) {
        if (L[i] == "Package: " pkg) hitP = 1
        if (L[i] == "Version: " ver) hitV = 1
      }
      if (!(hitP && hitV)) print
    }' Packages > "$TMP/kept"
else
  : > "$TMP/kept"
fi

# kept 每条记录以空行结尾(ORS="\n\n"),直接拼接即保持记录间空行分隔
cat "$TMP/kept" "$TMP/new-entry" > Packages
echo "" >> Packages

rm -f Packages.gz
gzip -9k Packages

# 3) Release:只索引 Packages/Packages.gz(staging 目录),不把仓库其他文件混进校验和
STAGE="$TMP/stage"
mkdir -p "$STAGE"
cp Packages Packages.gz "$STAGE/"
rm -f Release Release.gpg InRelease
apt-ftparchive release \
  -o APT::FTPArchive::Release::Origin="kivio-desktop" \
  -o APT::FTPArchive::Release::Label="kivio-desktop" \
  -o APT::FTPArchive::Release::Description="Kivio Desktop Linux packages" \
  "$STAGE" > Release

# 4) 签名:Release.gpg(分离签名) + InRelease(内嵌清签名),apt update 二者认其一
gpg --batch --yes --local-user "$KEYID" --armor --detach-sign --output Release.gpg Release
gpg --batch --yes --local-user "$KEYID" --clearsign --output InRelease Release

echo "apt 索引已更新:"
echo "  ${NEWPKG} ${NEWVER} -> ${BASE}/${DEBNAME}"
echo "  Packages 共 $(grep -c '^Package:' Packages) 条记录"
