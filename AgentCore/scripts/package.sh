#!/usr/bin/env sh
set -eu

workspace_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
target=${1:-$(rustc -vV | sed -n 's/^host: //p')}
profile=${PROFILE:-release}
output_root=${OUTPUT_ROOT:-"$workspace_root/dist"}

case "$target" in
  x86_64-apple-darwin) platform_folder=macos-x64 ;;
  aarch64-apple-darwin) platform_folder=macos-arm64 ;;
  x86_64-unknown-linux-gnu) platform_folder=linux-x64 ;;
  aarch64-unknown-linux-gnu) platform_folder=linux-arm64 ;;
  x86_64-unknown-linux-musl) platform_folder=linux-x64-musl ;;
  aarch64-unknown-linux-musl) platform_folder=linux-arm64-musl ;;
  *) echo "Unsupported distribution target: $target" >&2; exit 2 ;;
esac

cargo build --manifest-path "$workspace_root/Cargo.toml" --locked \
  -p mon-agent-runtime --profile "$profile" --target "$target"
output_directory="$output_root/$platform_folder"
mkdir -p "$output_directory"
cp "$workspace_root/target/$target/$profile/mon-agent-runtime" \
  "$output_directory/mon-agent-runtime"
chmod 755 "$output_directory/mon-agent-runtime"
(
  cd "$output_directory"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum mon-agent-runtime > mon-agent-runtime.sha256
  else
    shasum -a 256 mon-agent-runtime > mon-agent-runtime.sha256
  fi
)
printf '%s\n' "$output_directory/mon-agent-runtime"
