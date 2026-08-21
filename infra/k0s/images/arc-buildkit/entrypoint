#!/bin/sh
set -eu

backing_dir=/var/lib/nook-buildkit-backing
backing_file="$backing_dir/buildkit.ext4"
formatted_marker="$backing_dir/.formatted"
state_dir=/var/lib/buildkit
loop_device=/dev/loop0

mkdir -p "$backing_dir" "$state_dir"
if [ ! -b "$loop_device" ]; then
  mknod -m 0660 "$loop_device" b 7 0
fi
losetup -d "$loop_device" 2>/dev/null || true

if [ ! -f "$formatted_marker" ]; then
  truncate -s "${NOOK_BUILDKIT_STATE_IMAGE_SIZE:-96G}" "$backing_file"
  losetup "$loop_device" "$backing_file"
  mkfs.ext4 -q -F -m 0 "$loop_device"
  touch "$formatted_marker"
else
  losetup "$loop_device" "$backing_file"
fi

mount -t ext4 -o noatime "$loop_device" "$state_dir"

exec buildkitd "$@"
