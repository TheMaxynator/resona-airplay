#!/bin/sh
set -eu
APP_DIR=/media/developer/apps/usr/palm/applications/com.themaxynator.resonatv
for resona_node in /usr/bin/node /usr/bin/nodejs; do
  if [ -x "$resona_node" ]; then
    resona_run_dir=/var/lib/resona-tv
    umask 077
    mkdir -p "$resona_run_dir"
    nohup "$resona_node" "$APP_DIR/receiver-server.js" --host 0.0.0.0 --port 42700 --data-dir "$resona_run_dir" >"$resona_run_dir/receiver.log" 2>&1 </dev/null &
    exit 0
  fi
done
echo 'No compatible Node.js runtime was found on the TV.' >&2
exit 1
