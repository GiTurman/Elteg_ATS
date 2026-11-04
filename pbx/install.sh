#!/usr/bin/env bash
# GT-ATS — სადგურის დაყენება ერთი ბრძანებით (Ubuntu 24.04, root).
# ავტორი: Giorgi Turmanidze "GT"
#
#   curl -fsSL https://raw.githubusercontent.com/GiTurman/Elteg_ATS/main/pbx/install.sh | bash
#
# ორ რამეს გკითხავთ: აპის ვებჰუკის ტოკენს და Geonet-ის SIP პაროლს.
# განმეორებით გაშვება უსაფრთხოა (განახლება).
set -euo pipefail

REPO="https://github.com/GiTurman/Elteg_ATS.git"
DIR="/opt/Elteg_ATS"
TTY=/dev/tty

say() { printf '\n\033[1;34m▶ %s\033[0m\n' "$*"; }
ok() { printf '\033[1;32m✔ %s\033[0m\n' "$*"; }
die() { printf '\033[1;31m✘ %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" = "0" ] || die "გაუშვით root მომხმარებლით (ან: sudo bash)"

ask() { # ask <prompt> <default> [secret]
  local prompt=$1 def=${2:-} secret=${3:-} ans=""
  if [ -n "$secret" ]; then
    read -r -s -p "$prompt: " ans < "$TTY"; echo > "$TTY"
  else
    read -r -p "$prompt${def:+ [$def]}: " ans < "$TTY"
  fi
  printf '%s' "${ans:-$def}"
}

get_env() { grep -E "^$1=" .env | head -1 | cut -d= -f2- || true; }
set_env() { # set_env KEY VALUE
  local tmp; tmp=$(mktemp)
  KEY="$1" VAL="$2" awk 'BEGIN{k=ENVIRON["KEY"]; v=ENVIRON["VAL"]; done=0}
    index($0, k"=")==1 { print k"="v; done=1; next } { print }
    END{ if(!done) print k"="v }' .env > "$tmp"
  cat "$tmp" > .env; rm -f "$tmp"
}

say "სისტემური პაკეტები"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq git curl ufw openssl ca-certificates >/dev/null
if ! command -v docker >/dev/null 2>&1; then
  say "Docker-ის დაყენება"
  curl -fsSL https://get.docker.com | sh >/dev/null
fi
ok "Docker: $(docker --version | cut -d, -f1)"

say "კოდი: $DIR"
if [ -d "$DIR/.git" ]; then git -C "$DIR" pull -q --ff-only; else git clone -q "$REPO" "$DIR"; fi
cd "$DIR/pbx"

IP=$(curl -fsS --max-time 8 https://api.ipify.org || true)
[ -n "$IP" ] || IP=$(hostname -I | awk '{print $1}')
ok "სერვერის IP: $IP"

[ -f .env ] || cp .env.example .env
chmod 600 .env

say "პარამეტრები"
tok=$(get_env WEBHOOK_TOKEN)
if [ -z "$tok" ]; then
  echo "აპში: ტელეფონია → ვებჰუკის პარამეტრები → ტოკენი → თვალის ხატულა → კოპირება" > "$TTY"
  tok=$(ask "ჩასვით ვებჰუკის ტოკენი" "" secret)
  [ -n "$tok" ] || die "ტოკენი აუცილებელია"
  set_env WEBHOOK_TOKEN "$tok"
fi
pass=$(get_env TRUNK_PASS)
if [ -z "$pass" ]; then
  pass=$(ask "Geonet-ის SIP პაროლი (წერილიდან)" "" secret)
  [ -n "$pass" ] || die "SIP პაროლი აუცილებელია"
  set_env TRUNK_PASS "$pass"
fi
dom=$(get_env PBX_DOMAIN)
if [ -z "$dom" ] || [ "$dom" = "pbx.example.ge" ]; then
  def="${IP//./-}.sslip.io"
  dom=$(ask "სადგურის დომენი (Enter = უფასო $def)" "$def")
  set_env PBX_DOMAIN "$dom"
fi
set_env PUBLIC_IP "$IP"
[ -n "$(get_env REC_SECRET)" ] || set_env REC_SECRET "$(openssl rand -hex 16)"
ok "დომენი: $dom"

say "ფაიერვოლი"
trunk=$(get_env TRUNK_HOST)
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw allow 10000:10200/udp >/dev/null
[ -n "$trunk" ] && ufw allow from "$trunk" to any port 5060 proto udp >/dev/null
ufw --force enable >/dev/null
ok "ღიაა: 22, 80, 443/tcp · 10000–10200/udp · 5060/udp მხოლოდ $trunk-დან"

say "სადგურის აწყობა და გაშვება (პირველად ~3–5 წუთი)"
docker compose up -d --build

say "Geonet-ზე რეგისტრაციის მოლოდინი"
reg="არა"
for _ in $(seq 1 30); do
  if docker exec gt-ats-asterisk asterisk -rx 'pjsip show registrations' 2>/dev/null | grep -q 'Registered'; then
    reg="კი"; break
  fi
  sleep 5
done

echo
echo "════════════════════════════════════════════════════════"
echo " GT-ATS სადგური"
echo "  WebRTC მისამართი : wss://$dom/ws  (აპს ავტომატურად ეცნობა)"
echo "  Geonet რეგისტრაცია: $reg"
echo "  ოპერატორები       : $(docker exec gt-ats-asterisk asterisk -rx 'pjsip show aors' 2>/dev/null | grep -cE '^ +Aor: +[0-9]+ ' || echo 0)"
echo "════════════════════════════════════════════════════════"
if [ "$reg" != "კი" ]; then
  echo "⚠ რეგისტრაცია ჯერ არ გავიდა. შეამოწმეთ პაროლი (.env → TRUNK_PASS) და ჰკითხეთ Geonet-ს,"
  echo "  ხომ არ სჭირდებათ სერვერის IP ($IP) whitelist-ში. ლოგი: docker logs --tail 80 gt-ats-asterisk"
fi
echo "შემდეგი ნაბიჯი: აპში ოპერატორებმა განაახლონ გვერდი (F5) და ჩართონ „ხაზზე“."
