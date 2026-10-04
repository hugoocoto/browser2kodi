#!/bin/sh
# Installs the native messaging host the chrome2kodi extension talks to, for
# every Chromium-based browser that has a profile here.
#
#   ./install.sh                      # send2kodi found in PATH
#   ./install.sh --send2kodi PATH     # or at PATH
#   ./install.sh --uninstall
set -eu

NAME=com.hugoocoto.chrome2kodi
EXTENSION_ID=lcpbemmkcpclhkiaaleaknidflilgloo  # fixed by the key in manifest.json

here=$(cd "$(dirname "$0")" && pwd)
data=${XDG_DATA_HOME:-$HOME/.local/share}/chrome2kodi
host=$data/chrome2kodi-host
config=${XDG_CONFIG_HOME:-$HOME/.config}
browsers="google-chrome google-chrome-beta google-chrome-unstable chromium
          BraveSoftware/Brave-Browser vivaldi microsoft-edge net.imput.helium"

die() { echo "install.sh: $*" >&2; exit 1; }

send2kodi=""
uninstall=no
while [ $# -gt 0 ]; do
    case $1 in
        --send2kodi) [ $# -ge 2 ] || die "--send2kodi needs a path"; send2kodi=$2; shift ;;
        --uninstall) uninstall=yes ;;
        -h|--help) sed -n '2,7s/^# \{0,1\}//p' "$0"; exit 0 ;;
        *) die "unknown option: $1" ;;
    esac
    shift
done

if [ $uninstall = yes ]; then
    for b in $browsers; do
        rm -fv "$config/$b/NativeMessagingHosts/$NAME.json"
    done
    rm -rfv "$data"
    echo "Remove the extension itself in the browser, at chrome://extensions."
    exit 0
fi

[ -n "$send2kodi" ] || send2kodi=$(command -v send2kodi) ||
    die "send2kodi is not in PATH; install it, or pass --send2kodi PATH"
[ -x "$send2kodi" ] || die "not executable: $send2kodi"
send2kodi=$(cd "$(dirname "$send2kodi")" && pwd)/$(basename "$send2kodi")

mkdir -p "$data"
# The browser starts the host with a bare environment, PATH perhaps without
# send2kodi in it: so it gets told where it is.
sed "s|^SEND2KODI = \"\"|SEND2KODI = \"$send2kodi\"|" "$here/host/chrome2kodi-host" > "$host"
chmod 755 "$host"
echo "Host:      $host (runs $send2kodi)"

installed=0
for b in $browsers; do
    [ -d "$config/$b" ] || continue
    mkdir -p "$config/$b/NativeMessagingHosts"
    cat > "$config/$b/NativeMessagingHosts/$NAME.json" <<EOF
{
  "name": "$NAME",
  "description": "Sends what the chrome2kodi extension is given to Kodi, with send2kodi",
  "path": "$host",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXTENSION_ID/"]
}
EOF
    echo "Browser:   $config/$b"
    installed=$((installed + 1))
done
[ $installed -gt 0 ] || die "no Chrome, Chromium, Brave, Vivaldi, Edge or Helium profile in $config"

cat <<EOF

Now load the extension: open chrome://extensions, turn on Developer mode,
click "Load unpacked" and pick
    $here/extension
EOF
