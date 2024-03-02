#!/bin/bash

detect_cpu_arch() {
    CPU_ARCH="basic"
    if [ "$(uname -s)" == "Darwin" ]; then
        AVX=$(sysctl -a | grep avx1_0 | wc -l)
        AVX2=$(sysctl -a | grep avx2_0 | wc -l)
        AVX512=$(sysctl -a | grep avx512f | wc -l)
    else
        AVX=$(grep avx /proc/cpuinfo | wc -l)
        AVX2=$(grep avx2 /proc/cpuinfo | wc -l)
        AVX512=$(grep avx512 /proc/cpuinfo | wc -l)
    fi
    if [ "$AVX512" -gt 0 ]; then
        CPU_ARCH="AVX512"
    elif [ "$AVX2" -gt 0 ]; then
        CPU_ARCH="AVX2"
    elif [ "$AVX" -gt 0 ]; then
        CPU_ARCH="AVX"
    fi
    echo $CPU_ARCH
}

detect_platform() {
    OS_NAME=$(uname -s)
    OS_ARCH=$(uname -m)
    if [ "$OS_NAME" == "Linux" ]; then
        PLATFORM="manylinux_2_31_x86_64"
    elif [ "$OS_NAME" == "Darwin" ]; then
        PLATFORM="macosx_$(sw_vers -productVersion | cut -d. -f1-2)_$(uname -m)"
    else
        PLATFORM="unsupported"
    fi
    echo $PLATFORM
}

detect_gpu_acceleration() {
    CUDA_VERSION=""
    ROCM_VERSION=""
    ACCELERATION="cpu"

    if command -v nvcc &> /dev/null; then
        CUDA_VERSION=$(nvcc --version | grep "release" | awk '{print $6}' | cut -d'.' -f1-2 | sed 's/[^0-9]//g')
        ACCELERATION="cu$CUDA_VERSION"
    elif command -v rocm-info &> /dev/null; then
        ROCM_VERSION=$(rocm-info | grep -oP 'Version:\s+\K[0-9.]+')
        ACCELERATION="rocm$ROCM_VERSION"
    elif [ "$(uname -s)" == "Darwin" ]; then
        ACCELERATION="metal"
    fi

    echo "$ACCELERATION"
}

detect_latest_accelerated_version() {
    CPU_ARCH=$(detect_cpu_arch)
    PLATFORM=$(detect_platform)
    ACCELERATION=$(detect_gpu_acceleration)
    PYTHON_VERSION=$(python --version 2>&1 | grep -oP 'Python \K[0-9]+\.[0-9]+')
    PYTHON_VERSION_CONCATENATED=$(echo $PYTHON_VERSION | tr -d '.')  # Convert to e.g., 311

    URL="https://jllllll.github.io/llama-cpp-python-cuBLAS-wheels/${CPU_ARCH}/${ACCELERATION}/llama-cpp-python/"
    LATEST_WHEEL=$(curl -s $URL | grep -oP "href=\"\K(.*?cp${PYTHON_VERSION_CONCATENATED}.*?${PLATFORM}.*?\.whl)" | sort -V | tail -n 1)

    if [ -z "$LATEST_WHEEL" ]; then
        echo "No suitable wheel file found for the current configuration."
        exit 1
    fi

    echo "$LATEST_WHEEL"
}

check_and_install() {
    LATEST_WHEEL=$(detect_latest_accelerated_version)
    if [ -z "$LATEST_WHEEL" ]; then
        echo "WARNING: Unable to find a compatible wheel file, installing an unaccelerated version."
        python -m pip install llama-cpp-python
    fi

    WHL_FILE=$(basename "$LATEST_WHEEL")
    LATEST_VERSION=$(echo "$WHL_FILE" | grep -oP "llama_cpp_python-\K([0-9]+\.[0-9]+\.[0-9]+(\+[a-z0-9]+)?)")

    INSTALLED_VERSION=$(pip list --format=freeze | grep "llama_cpp_python==" | cut -d'=' -f3 || echo "")

    if [ "$INSTALLED_VERSION" = "$LATEST_VERSION" ]; then
        echo "The latest version of llama-cpp-python ($LATEST_VERSION) is already installed."
    else
        echo "Installing the latest version of llama-cpp-python ($LATEST_VERSION) for your system ($INSTALLED_VERSION) is installed)"
        python -m pip install --prefer-binary --force-reinstall "$LATEST_WHEEL"
    fi
}

echo "Checking for llama-cpp-python installation..."
check_and_install

echo "Installation complete. Please check for any errors above."
