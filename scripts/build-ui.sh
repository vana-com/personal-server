#!/bin/bash

set -e

echo "Building Selfie UI..."
cd selfie-ui

if command -v yarn &> /dev/null; then
    yarn install --frozen-lockfile --non-interactive
    yarn run build
else
    npm install --no-prompt --cache .npm
    # npm ci --cache .npm # requires a lockfile
    NODE_ENV=production npm run build
fi

echo "Moving built files to Selfie API app..."
cd ..
rm -rf selfie/web
mkdir -p selfie/web
cp -r selfie-ui/out/* selfie/web/

echo "Selfie UI built and integrated with API."
