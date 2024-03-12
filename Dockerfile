# Use the base image
FROM selfie-base as selfie

# Use the CPU-specific stage
FROM selfie-cpu as selfie-cpu

# Use the GPU-specific stage
FROM selfie-gpu as selfie-gpu

# Use the ARM64-specific stage
FROM selfie-arm64 as selfie-arm64