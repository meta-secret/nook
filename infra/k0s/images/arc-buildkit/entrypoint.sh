#!/bin/sh
set -eu

backing_dir=/var/lib/nook-buildkit-backing
backing_file="$backing_dir/buildkit.ext4"
formatted_marker="$backing_dir/.formatted"
state_dir=/var/lib/buildkit

mkdir -p "$backing_dir" "$state_dir"

if [ ! -f "$formatted_marker" ]; then
  truncate -s "${NOOK_BUILDKIT_STATE_IMAGE_SIZE:-96G}" "$backing_file"
  loop_device="$(losetup --find --show "$backing_file")"
  mkfs.ext4 -q -F -m 0 "$loop_device"
  touch "$formatted_marker"
else
  loop_device="$(losetup --find --show "$backing_file")"
fi

mount -t ext4 -o noatime "$loop_device" "$state_dir"

exec buildkitd "$@"
