#!/bin/bash
# Turns the extension/ folder into an Xcode project for iPhone and iPad.
# Run this on a Mac that has Xcode installed:
#
#     ./build-on-mac.sh yourname
#
# "yourname" makes the app's ID unique to you (letters and numbers only).

set -e
cd "$(dirname "$0")"

NAME="${1:-}"
if [ -z "$NAME" ]; then
  echo "Usage: ./build-on-mac.sh yourname     (letters and numbers only, e.g. ./build-on-mac.sh sam)"
  exit 1
fi
if ! xcrun --find safari-web-extension-converter >/dev/null 2>&1; then
  echo "Xcode is missing. Install Xcode from the Mac App Store, open it once, then run this again."
  exit 1
fi

# Apple's own converter writes the Swift app, the extension target and the app icon.
xcrun safari-web-extension-converter ./extension \
  --project-location ./xcode \
  --app-name ShutEye \
  --bundle-identifier "com.$NAME.ShutEye" \
  --swift \
  --ios-only \
  --copy-resources \
  --no-prompt \
  --force

echo
echo "Done. Xcode is opening the ShutEye project. Follow step 3 in README.md."
