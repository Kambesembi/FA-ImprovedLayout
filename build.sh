#!/bin/sh
# Builds the release packages into dist/:
#   FA-ImprovedLayout-vX-chrome.zip   (folder for "Load unpacked" / Chrome Web Store)
#   FA-ImprovedLayout-vX-firefox.zip  (manifest.firefox.json as manifest.json, for addons.mozilla.org)
set -e
cd "$(dirname "$0")"
V=$(sed -n 's/.*"version": "\(.*\)".*/\1/p' manifest.json)
FILES="background.js content.js features.css features.js uploader.js i18n.js popup.html popup.js settings.js ultrawide.css walls.html walls.js walls.css icon16.png icon32.png icon48.png icon128.png"
rm -rf dist && mkdir -p dist/FA-ImprovedLayout dist/firefox
cp $FILES manifest.json dist/FA-ImprovedLayout/
cp $FILES dist/firefox/ && cp manifest.firefox.json dist/firefox/manifest.json
(cd dist && zip -qr "FA-ImprovedLayout-v$V-chrome.zip" FA-ImprovedLayout)
(cd dist/firefox && zip -qr "../FA-ImprovedLayout-v$V-firefox.zip" .)
rm -rf dist/FA-ImprovedLayout dist/firefox
ls dist
