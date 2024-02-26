#!/bin/bash

echo "Installing llama-cpp-python with hardware acceleration support."

# Detect operating system
OS="$(uname -s)"
case "${OS}" in
    Linux*)     os=Linux;;
    Darwin*)    os=macOS;;
    CYGWIN*)    os=Cygwin;;
    MINGW*)     os=MinGw;;
    *)          os="UNKNOWN:${OS}"
esac

echo "Detected operating system: $os"

# Default to AVX2 CPU architecture
CPU_ARCH="AVX2"

# Allow user to override CPU architecture
read -p "Enter your CPU architecture (AVX, AVX2, AVX512, basic) or press enter to use default (AVX2): " user_arch
if [ ! -z "$user_arch" ]; then
    CPU_ARCH=$user_arch
fi

# Installation command initialization
INSTALL_CMD=""

if [ "$os" == "Linux" ]; then
    # Attempt to detect CUDA for Linux
    CUDA_VERSION_OUTPUT=$(nvcc --version | grep "release" | awk '{print $6}' | cut -d'.' -f1-2)
    CUDA_VERSION="cu${CUDA_VERSION_OUTPUT//[[:alpha:]|\.]/}"

    # Attempt to detect ROCm installation by checking for common ROCm utilities
    ROCM_INFO=$(rocm-info 2>/dev/null | grep -oP 'ROCm Version:\s*\K[\d.]+')

    if [ -n "$CUDA_VERSION_OUTPUT" ]; then
        echo "Detected CUDA version: $CUDA_VERSION"
        INSTALL_CMD="python -m pip install llama-cpp-python --prefer-binary --force-reinstall --extra-index-url=https://jllllll.github.io/llama-cpp-python-cuBLAS-wheels/${CPU_ARCH}/${CUDA_VERSION}"
    elif [ -n "$ROCM_INFO" ]; then
        echo "Detected ROCm version: $ROCM_INFO"
        # Convert ROCm version to a format compatible with your URL structure
        ROCM_VERSION="rocm$(echo $ROCM_INFO | tr -d '.')"
        INSTALL_CMD="python -m pip install llama-cpp-python --prefer-binary --force-reinstall --extra-index-url=https://jllllll.github.io/llama-cpp-python-cuBLAS-wheels/${CPU_ARCH}/${ROCM_VERSION}"
    else
        echo "Neither CUDA nor ROCm could be confidently detected. Please ensure your system's hardware acceleration drivers are correctly installed."
        exit 1
    fi
elif [ "$os" == "macOS" ]; then
    echo "For macOS, using Metal version."
    INSTALL_CMD="python -m pip install llama-cpp-python --prefer-binary --force-reinstall --extra-index-url=https://jllllll.github.io/llama-cpp-python-cuBLAS-wheels/basic/cpu"
else
    echo "Unsupported OS or CUDA/ROCm/Metal not applicable. Skipping hardware-accelerated llama-cpp-python installation."
    exit 1
fi

# Execute the installation command
echo "Running installation command:"
echo $INSTALL_CMD
eval $INSTALL_CMD

echo "Installation complete. Please check for any errors above."
