#!/bin/bash

# Variables
APP_NAME="Selfie"
BUNDLE_IDENTIFIER="com.vana.selfie"
VERSION="0.1.0"
EXECUTABLE_NAME="selfie"
DIST_DIR="dist/selfie"
APP_DIR="${DIST_DIR}/${APP_NAME}.app"
CONTENTS_DIR="${APP_DIR}/Contents"
MACOS_DIR="${CONTENTS_DIR}/MacOS"
RESOURCES_DIR="${CONTENTS_DIR}/Resources"
INFO_PLIST="${CONTENTS_DIR}/Info.plist"

# Create .app directory structure
mkdir -p "${MACOS_DIR}"
mkdir -p "${RESOURCES_DIR}"

# Move the executable
mv "${DIST_DIR}/${EXECUTABLE_NAME}" "${MACOS_DIR}/"

# Move resources and libraries
mv "${DIST_DIR}/_internal" "${RESOURCES_DIR}/"
#mv "${DIST_DIR}/_internal/data" "${RESOURCES_DIR}/data"

# Create Info.plist
cat <<EOF > "${INFO_PLIST}"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>${EXECUTABLE_NAME}</string>
    <key>CFBundleIdentifier</key>
    <string>${BUNDLE_IDENTIFIER}</string>
    <key>CFBundleName</key>
    <string>${APP_NAME}</string>
    <key>CFBundleVersion</key>
    <string>${VERSION}</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
</dict>
</plist>
EOF

echo "${APP_NAME}.app bundle has been created."

# Developer ID
CERT="Developer ID Application: Corsali, Inc (G7QNBSSW44)"

APP_CONTENTS="${APP_DIR}/Contents"

# Find and sign all executables, dylibs, and .so files
find "$APP_CONTENTS" \( -type f -perm +111 -o -name "*.dylib" -o -name "*.so" \) -exec codesign --force --sign "$CERT" --timestamp --options runtime '{}' +

# Sign the app bundle itself
codesign --deep --force --verbose --timestamp --options runtime --sign "$CERT" "${APP_DIR}"
