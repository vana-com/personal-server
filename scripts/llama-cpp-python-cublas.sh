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


detect_gpu_acceleration() {
    CUDA_VERSION=""
    ROCM_VERSION=""
    ACCELERATION="cpu"

    if command -v nvcc &> /dev/null; then
        CUDA_VERSION=$(nvcc --version | awk '/release/ {print $5}' | cut -d',' -f1 | tr -cd '[0-9]')

        ACCELERATION="cu$CUDA_VERSION"
    elif command -v rocm-info &> /dev/null; then
        ROCM_VERSION=$(rocm-info | awk '/Version:/ {print $2}' | tr -d '.')
        ACCELERATION="rocm$ROCM_VERSION"
    elif [ "$(uname -s)" == "Darwin" ]; then
        ACCELERATION="cpu"
    fi

    echo "$ACCELERATION"
}

get_index_url() {
    CPU_ARCH=$(detect_cpu_arch)
    ACCELERATION=$(detect_gpu_acceleration)

    echo "https://jllllll.github.io/llama-cpp-python-cuBLAS-wheels/${CPU_ARCH}/${ACCELERATION}"
}


echo "Installing accelerated llama-cpp-python..."
poetry run python -m pip install llama-cpp-python --prefer-binary --force-reinstall --extra-index-url="$(get_index_url)"

echo "Installation complete. Please check for any errors above."

