#!/usr/bin/env bash
# Bounded resource diagnostics for the Website e2e CI suites.
#
# The control-plane suite runs nine Angular dev servers, `next dev`, Python
# fixtures and Chromium on one 16 GB runner. It has failed intermittently in
# two shapes: the runner stops reporting ("lost communication"), or the
# Website server on 4308 stops answering while Playwright keeps running. The
# job logs cannot tell memory exhaustion, swap thrash and a stuck Next worker
# apart, so this records what the runner looked like while the suite ran.
#
#   website-e2e-resources.sh sample <log>   sample every 15 s until killed or
#                                           240 samples (one hour) have run
#   website-e2e-resources.sh report <log>   summarise a sample log
#
# `sample` writes detail to <log> and one compact line per sample to stdout.
set -u

mode=${1:-}
log=${2:-}
interval=${WEBSITE_RESOURCES_INTERVAL:-15}
limit=${WEBSITE_RESOURCES_SAMPLES:-240}
probe_url=${WEBSITE_RESOURCES_PROBE:-http://127.0.0.1:4308/favicon.ico}

if [ -z "$mode" ] || [ -z "$log" ]; then
  echo "usage: $0 sample|report <log>" >&2
  exit 2
fi

meminfo() {
  awk '/^MemTotal:/{t=$2} /^MemAvailable:/{a=$2} /^SwapTotal:/{st=$2} /^SwapFree:/{sf=$2}
    END {printf "total_mb=%d avail_mb=%d swap_used_mb=%d", t/1024, a/1024, (st-sf)/1024}' /proc/meminfo
}

pressure() {
  if [ -r /proc/pressure/memory ]; then
    awk '{split($2, v, "="); printf " psi_%s10=%s", $1, v[2]}' /proc/pressure/memory
  fi
}

# Resident memory summed by command name, largest first.
rss_by_command() {
  ps -eo comm=,rss= | awk '{s[$1]+=$2} END {for (c in s) printf "%d %s\n", s[c]/1024, c}' |
    sort -rn | head -6 | awk '{printf " %s=%dMB", $2, $1}'
}

next_workers() {
  ps -eo pid=,args= | awk '/next-server|next\/dist\/server\/lib\/start-server/ && !/awk/ {print $1}'
}

describe_stuck_worker() {
  for pid in $(next_workers); do
    echo "next worker $pid"
    grep -E '^(State|VmRSS|VmSwap|Threads):' "/proc/$pid/status" 2>/dev/null | tr -s '\t ' ' '
    echo "wchan $(cat "/proc/$pid/wchan" 2>/dev/null)"
    top -H -b -n 1 -p "$pid" 2>/dev/null | sed -n '7,14p'
  done
}

sample() {
  : > "$log"
  local n=0
  while [ "$n" -lt "$limit" ]; do
    n=$((n + 1))
    local now mem load probe status
    now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    mem="$(meminfo)$(pressure)"
    load=$(cut -d' ' -f1-3 /proc/loadavg)
    probe=$(curl -s -o /dev/null -w '%{http_code} %{time_total}s' --max-time 5 "$probe_url" 2>/dev/null)
    status=${probe%% *}
    [ -n "$status" ] || status=000
    {
      echo "=== $now"
      echo "mem $mem load=\"$load\" website=\"$probe\""
      echo "rss$(rss_by_command)"
      ps -eo pid=,ppid=,stat=,rss=,pcpu=,etimes=,args= --sort=-rss | head -12 |
        awk '{printf "ps %s %s %s %dMB %s%% %ss ", $1, $2, $3, $4/1024, $5, $6; $1=$2=$3=$4=$5=$6=""; print substr($0, 7, 140)}'
      case "$status" in
        2??|3??) ;;
        *) echo "stuck website probe status=$status"; describe_stuck_worker | sed 's/^/stuck /' ;;
      esac
    } >> "$log"
    echo "[resources] $now $mem load=\"$load\" website=\"$probe\""
    sleep "$interval"
  done
}

report() {
  if [ ! -s "$log" ]; then
    echo "No resource samples were recorded."
    return 0
  fi
  echo "Website runner resources ($(grep -c '^=== ' "$log") samples)"
  awk '
    /^=== / {t=$2}
    /^mem / {
      for (i=2; i<=NF; i++) { split($i, kv, "="); v[kv[1]]=kv[2] }
      if (min_avail == "" || v["avail_mb"]+0 < min_avail) { min_avail=v["avail_mb"]+0; min_at=t; total=v["total_mb"] }
      if (v["swap_used_mb"]+0 > max_swap) { max_swap=v["swap_used_mb"]+0; swap_at=t }
      if (v["psi_full10"]+0 > max_full) { max_full=v["psi_full10"]+0; full_at=t }
    }
    /^stuck website probe/ { stuck++; if (first_stuck == "") first_stuck=t }
    /^ps / {
      label=""; for (i=8; i<=NF && i<14; i++) label=label " " $i
      rss=$5; sub(/MB$/, "", rss)
      if (rss+0 > peak[label]) { peak[label]=rss+0; peak_at[label]=t }
    }
    END {
      printf "lowest MemAvailable: %d MB of %d MB at %s\n", min_avail, total, min_at
      printf "highest swap used: %d MB%s\n", max_swap, (swap_at ? " at " swap_at : "")
      printf "highest memory pressure (full avg10): %s%s\n", max_full + 0, (full_at ? " at " full_at : "")
      printf "website probe failures: %d%s\n", stuck, (first_stuck ? ", first at " first_stuck : "")
      print "peak resident memory by process:"
      for (l in peak) printf "%d MB at %s:%s\n", peak[l], peak_at[l], l | "sort -rn | head -10"
    }' "$log"
  if grep -q '^stuck ' "$log"; then
    echo "first website probe failures:"
    grep '^stuck \|^=== ' "$log" | grep -B1 '^stuck ' | head -60
  fi
  echo "last sample:"
  awk '/^=== /{block=""} {block=block $0 "\n"} END {printf "%s", block}' "$log"
  if command -v dmesg >/dev/null 2>&1; then
    kernel=$( (sudo -n dmesg -T 2>/dev/null || dmesg -T 2>/dev/null) | grep -iE 'out of memory|oom-kill|killed process|hung_task' | tail -20)
    echo "kernel memory events: ${kernel:-none}"
  fi
}

case "$mode" in
  sample) sample ;;
  report) report ;;
  *) echo "usage: $0 sample|report <log>" >&2; exit 2 ;;
esac
