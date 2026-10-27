#!/usr/bin/env bash
# Replaces nesting/packingsolver/ with PackingSolver at the given upstream commit (or branch)
# and applies our patches from nesting/patches/ in order.
#
#   ./update-packingsolver.sh            # latest master
#   ./update-packingsolver.sh 9fc5d6e0   # a given commit
#   ./update-packingsolver.sh --check    # only check that packingsolver/ is the recorded
#                                        # commit + our patches (used by CI)
#
# Left out of the copy: data/ (260 MB of benchmark instances), doc/, img/, .github/.
# A patch that no longer applies stops the script: fix the patch, then run it again.
set -euo pipefail

UPSTREAM=https://github.com/fontanf/packingsolver.git
HERE="$(cd "$(dirname "$0")" && pwd)"
DEST="$HERE/packingsolver"
VERSION_FILE="$HERE/PACKINGSOLVER_VERSION"

check=false
ref="master"
if [[ "${1:-}" == "--check" ]]; then
  check=true
  ref="$(grep '^commit' "$VERSION_FILE" | awk '{print $2}')"
elif [[ -n "${1:-}" ]]; then
  ref="$1"
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

git clone --quiet --filter=blob:none --no-checkout "$UPSTREAM" "$work/src"
git -C "$work/src" checkout --quiet "$ref"
commit="$(git -C "$work/src" rev-parse HEAD)"
date="$(git -C "$work/src" log -1 --format=%cs)"

mkdir -p "$work/copy"
git -C "$work/src" archive --format=tar HEAD -- . ':!data' ':!doc' ':!img' ':!.github' | tar -x -C "$work/copy"

for p in "$HERE"/patches/*.patch; do
  [[ -e "$p" ]] || continue
  echo "applying $(basename "$p")"
  (cd "$work/copy" && patch -p1 --quiet --no-backup-if-mismatch < "$p")
done

if $check; then
  if diff -r "$work/copy" "$DEST" > "$work/diff.txt"; then
    echo "packingsolver/ = upstream $commit + our patches"
  else
    echo "packingsolver/ differs from upstream $commit + our patches:"
    head -50 "$work/diff.txt"
    exit 1
  fi
  exit 0
fi

rm -rf "$DEST"
mv "$work/copy" "$DEST"
cat > "$VERSION_FILE" <<EOF
# PackingSolver copied into nesting/packingsolver/ by update-packingsolver.sh
upstream $UPSTREAM
commit $commit
date $date
EOF
echo "nesting/packingsolver/ is now upstream $commit ($date) + our patches"
echo "next: build it, run nestprep compare on a test job, and commit"
