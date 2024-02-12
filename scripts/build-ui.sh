#!/bin/bash

set -e

# Step 1: Build Next.js App
echo "Building Next.js app..."
cd selfie-ui
yarn install
# NODE_ENV=production yarn install --production --frozen-lockfile
yarn run build

# Step 2: Move the out/ directory to FastAPI static file serving directory
echo "Moving built files to FastAPI app..."
cd ..
rm -rf selfie/web
mkdir -p selfie/web
cp -r selfie-ui/out/* selfie/web/

echo "Next.js app built and integrated with FastAPI."
