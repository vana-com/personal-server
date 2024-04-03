#!/bin/bash

TARGET_ARCH=$1

if [ -z "$TARGET_ARCH" ]; then
    echo "Please provide the target architecture (cpu, gpu, or arm64) as an argument."
    exit 1
fi

case $TARGET_ARCH in
    cpu)
        docker build -t selfie:cpu -f docker/Dockerfile.ui -f docker/Dockerfile.cpu .
        ;;
    gpu)
        docker build -t selfie:gpu -f docker/Dockerfile.ui -f docker/Dockerfile.gpu .
        ;;
    arm64)
        docker build -t selfie:arm64 -f docker/Dockerfile.ui -f docker/Dockerfile.arm64 .
        ;;
    *)
        echo "Invalid target architecture. Please choose from cpu, gpu, or arm64."
        exit 1
        ;;
esac