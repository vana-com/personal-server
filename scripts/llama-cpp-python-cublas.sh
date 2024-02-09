#!/bin/bash

echo "Installing llama-cpp-python with cuBLAS support."

# Detect installed CUDA version
CUDA_VERSION_OUTPUT=$(nvcc --version | grep "release" | awk '{print $6}' | cut -d'.' -f1-2)
CUDA_VERSION="cu${CUDA_VERSION_OUTPUT//[[:alpha:]|\.]/}"

if [ -z "$CUDA_VERSION_OUTPUT" ]; then
    echo "CUDA version could not be detected. Please ensure CUDA is installed."
    exit 1
else
    echo "Detected CUDA version: $CUDA_VERSION"
fi

# Default to AVX2 CPU architecture
CPU_ARCH="AVX2"

# Allow user to override CPU architecture
read -p "Enter your CPU architecture (AVX, AVX2, AVX512, basic) or press enter to use default (AVX2): " user_arch
if [ ! -z "$user_arch" ]; then
    CPU_ARCH=$user_arch
fi

# Construct the pip install command
INSTALL_CMD="python -m pip install llama-cpp-python --prefer-binary --force-reinstall --extra-index-url=https://jllllll.github.io/llama-cpp-python-cuBLAS-wheels/${CPU_ARCH}/${CUDA_VERSION}"

# Execute the installation command
echo "Running installation command:"
echo $INSTALL_CMD
eval $INSTALL_CMD

echo "Installation complete. Please check for any errors above."
