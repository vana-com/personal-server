# Base image for building the UI
FROM node:18.19-alpine3.18 AS selfie-ui
WORKDIR /selfie
COPY selfie-ui/package.json selfie-ui/yarn.lock ./
RUN yarn install --frozen-lockfile --non-interactive
COPY selfie-ui/ .
RUN yarn run build

# Base image for the application
FROM python:3.11 as selfie-base
ENV PYTHONDONTWRITEBYTECODE 1
ENV PYTHONUNBUFFERED 1
ENV PIP_NO_CACHE_DIR=1
WORKDIR /selfie
COPY . .
COPY --from=selfie-ui /selfie/out/ ./selfie-ui/out
RUN pip install poetry --no-cache-dir
RUN poetry config virtualenvs.create false
RUN poetry install --no-interaction --no-ansi
EXPOSE 8181

# CPU-specific configuration
FROM selfie-base as selfie-cpu
CMD ["python", "-m", "selfie"]

# GPU-specific configuration using an NVIDIA base image
# Ensure that the chosen image version has wheels available at https://jllllll.github.io/llama-cpp-python-cuBLAS-wheels.
# You can see what CUDA version an image uses at https://docs.nvidia.com/deeplearning/frameworks/support-matrix/index.html.
# For example, the image nvcr.io/nvidia/pytorch:23.10-py3 uses CUDA 12.2, which is available at https://jllllll.github.io/llama-cpp-python-cuBLAS-wheels/AVX2/cu122.
FROM nvcr.io/nvidia/pytorch:23.10-py3 as selfie-gpu
COPY --from=selfie-base /selfie /selfie
WORKDIR /selfie

RUN pip install poetry --no-cache-dir
ENV PATH="/root/.local/bin:$PATH"
RUN poetry install --no-interaction --no-ansi

RUN bash /selfie/scripts/llama-cpp-python-cublas.sh

# --verbose and other options should probably be controlled by the user
CMD ["poetry", "run", "python", "-m", "selfie", "--gpu", "--verbose"]

# ARM64-specific configuration (Apple Silicon)
FROM selfie-base as selfie-arm64
# Uncomment below if additional dependencies are needed for ARM64
# RUN apt-get update && apt-get install -y --no-install-recommends <arm64-specific-dependencies> && rm -rf /var/lib/apt/lists/*
CMD if [ "$(uname -m)" = "arm64" ]; then \
        echo "Running with GPU support"; \
        python -m selfie --gpu; \
    else \
        echo "Running without GPU support"; \
        python -m selfie; \
    fi
