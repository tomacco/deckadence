#!/usr/bin/env bash
# Deckadence still-mode screenshots — Tier 1 of references/pitfalls.md.
#   components/verify/shoot.sh deck/index.html            # every station
#   components/verify/shoot.sh deck/index.html s3 s7      # named stations only
# Writes .shots/<station-id>.png next to the deck, then you READ the images.
#
# Shoots with ?still=1 (flat mode). Without it a headless screenshot lands mid-animation and
# photographs an EMPTY station, which looks like a pass and hides every layout bug.
# It cannot capture motion, transitions or presenter beats — verify those live.
set -uo pipefail

DECK="${1:?usage: shoot.sh <deck.html> [station-id ...]}"
shift || true
[ -f "$DECK" ] || { echo "no such file: $DECK" >&2; exit 1; }
ROOT="$(cd "$(dirname "$DECK")" && pwd)"; PAGE="$(basename "$DECK")"
OUT="$ROOT/.shots"; mkdir -p "$OUT"

# Non-16:9 on purpose: the letterbox bars only appear off-16:9, and bars whose tone does not
# match the station are a real bug you cannot see in a 1920x1080 shot.
W="${DECK_SHOT_W:-1600}"; H="${DECK_SHOT_H:-1000}"

# ---------- stations ----------
if [ "$#" -gt 0 ]; then STATIONS=("$@"); else
  mapfile -t STATIONS < <(grep -oE '<section[^>]*class="[^"]*station[^"]*"[^>]*>' "$DECK" \
    | grep -oE 'id="[^"]+"' | cut -d'"' -f2)
fi
[ "${#STATIONS[@]}" -gt 0 ] || { echo "no stations found in $DECK" >&2; exit 1; }

# ---------- browser ----------
WINDOWS=0
if [ -n "${DECK_BROWSER:-}" ]; then BROWSER="$DECK_BROWSER"
elif grep -qi microsoft /proc/version 2>/dev/null; then
  for c in "/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" \
           "/mnt/c/Program Files/Microsoft/Edge/Application/msedge.exe" \
           "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe"; do
    [ -f "$c" ] && { BROWSER="$c"; WINDOWS=1; break; }
  done
fi
: "${BROWSER:=$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)}"
[ -n "$BROWSER" ] || { echo "no headless browser found — set DECK_BROWSER" >&2; exit 1; }
case "$BROWSER" in *.exe) WINDOWS=1;; esac
# A Windows browser writes to WINDOWS paths; stage there, then copy back into Linux to read.
if [ "$WINDOWS" = 1 ]; then
  # Pick a WRITABLE one: the glob also matches Default / "Default User", which are not.
  STAGE=""
  for d in /mnt/c/Users/*/AppData/Local/Temp; do [ -w "$d" ] && { STAGE="$d"; break; }; done
  [ -n "$STAGE" ] || { echo "cannot find a writable Windows temp dir" >&2; exit 1; }
  STAGE="$STAGE/deckshots.$$"; mkdir -p "$STAGE"
  winpath() { wslpath -w "$1" 2>/dev/null || echo "$1"; }
fi

# ---------- server (never assume a port is free) ----------
PORT=""
for _ in 1 2 3; do
  p="$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()')"
  python3 -m http.server "$p" --bind 127.0.0.1 --directory "$ROOT" >/dev/null 2>&1 &
  SRV=$!; sleep 1
  if ss -ltn 2>/dev/null | grep -q ":$p\b"; then PORT="$p"; break; fi
  kill "$SRV" 2>/dev/null
done
[ -n "$PORT" ] || { echo "could not start a server" >&2; exit 1; }
cleanup() { kill "$SRV" 2>/dev/null; [ "$WINDOWS" = 1 ] && rm -rf "$STAGE" 2>/dev/null; }
trap cleanup EXIT

echo "serving $ROOT on $PORT · $((${#STATIONS[@]})) stations · ${W}x${H}"
rc=0
for id in "${STATIONS[@]}"; do
  final="$OUT/$id.png"; rm -f "$final"
  if [ "$WINDOWS" = 1 ]; then staged="$STAGE/$id.png"; target="$(winpath "$staged")"; udd="$(winpath "$STAGE/udd-$id")"
  else staged="$final"; target="$final"; udd="${TMPDIR:-/tmp}/deck-udd-$$-$id"; fi
  # --run-all-compositor-stages-before-draw, NOT --virtual-time-budget: the latter shoots
  # before a late stylesheet applies (blank white frame) and hangs on endless rAF.
  # Unique --user-data-dir per shot: a shared profile lock yields 0-byte PNGs.
  timeout 90 "$BROWSER" --headless=new --disable-gpu --hide-scrollbars \
    --window-size="$W,$H" --run-all-compositor-stages-before-draw \
    --user-data-dir="$udd" --screenshot="$target" \
    "http://127.0.0.1:$PORT/$PAGE?still=1#$id" >/dev/null 2>&1
  # The browser exits NONZERO even on success — poll for the file, never trust $?.
  for _ in $(seq 1 30); do [ -s "$staged" ] && break; sleep 1; done
  if [ -s "$staged" ]; then
    [ "$staged" = "$final" ] || cp "$staged" "$final"
    echo "  $id  ->  $final"
  else
    echo "  $id  ->  NO IMAGE (blank-frame load race? retry this one)"; rc=1
  fi
done
echo "now READ the PNGs in $OUT — a deck you have not looked at is not verified"
exit $rc
