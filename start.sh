#!/bin/bash

if [ ! -f "selfie/.env" ]; then
    echo "Copying selfie/.env.example to selfie/.env..."
    cp selfie/.env.example selfie/.env
else
    echo "selfie/.env already exists. Skipping copy."
fi

MISSING_DEPENDENCIES=""

PYTHON_COMMAND=$(command -v python3 || { command -v python &>/dev/null && python --version 2>&1 | grep -q "Python 3" && echo python; })
[ -z "$PYTHON_COMMAND" ] && MISSING_DEPENDENCIES="${MISSING_DEPENDENCIES} Python 3 (https://www.python.org/downloads/)\n"
command -v poetry >/dev/null 2>&1 || MISSING_DEPENDENCIES="${MISSING_DEPENDENCIES} Poetry (https://python-poetry.org/docs/#installation)\n"
command -v yarn >/dev/null 2>&1 || MISSING_DEPENDENCIES="${MISSING_DEPENDENCIES} Yarn (https://yarnpkg.com/getting-started/install)\n"

if [ ! -z "$MISSING_DEPENDENCIES" ]; then
    echo -e "Missing dependencies:\n$MISSING_DEPENDENCIES"
    exit 1
fi

if command -v nvcc &>/dev/null || command -v rocm-info &>/dev/null || [ "$(uname -m)" = "arm64" ]; then
    GPU_FLAG="--gpu"
else
    GPU_FLAG=""
fi

echo "Installing Python dependencies with Poetry..."
poetry check || poetry install

echo "Building UI with Yarn..."
./scripts/build-ui.sh

echo "Running llama-cpp-python-cublas.sh to enable hardware acceleration..."
./scripts/llama-cpp-python-cublas.sh

echo "Running selfie..."
poetry run python -m selfie $GPU_FLAG
