#!/bin/bash

# Variables
APP_NAME="Selfie"
APP_DIR="dist/Selfie.app"
APP_CONTENTS="${APP_DIR}/Contents"
CERT="Developer ID Application: Corsali, Inc (G7QNBSSW44)"

# Find and sign all executables, dylibs, and .so files
find "$APP_CONTENTS" -type f \( -perm +111 -o -name "*.dylib" -o -name "*.so" \) -exec codesign --force --sign "$CERT" --timestamp --options runtime '{}' \+

# Sign the app bundle itself
codesign --deep --force --verbose --timestamp --options runtime --sign "$CERT" "${APP_DIR}"
