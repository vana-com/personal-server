#!/bin/bash

MISSING_DEPENDENCIES=""

PYTHON_COMMAND=$(command -v python3 || { command -v python &>/dev/null && python --version 2>&1 | grep -q "Python 3" && echo python; })
[ -z "$PYTHON_COMMAND" ] && MISSING_DEPENDENCIES="${MISSING_DEPENDENCIES} Python 3 (https://www.python.org/downloads/)\n"
command -v poetry >/dev/null 2>&1 || MISSING_DEPENDENCIES="${MISSING_DEPENDENCIES} Poetry (https://python-poetry.org/docs/#installation)\n"
command -v yarn >/dev/null 2>&1 || MISSING_DEPENDENCIES="${MISSING_DEPENDENCIES} Yarn (https://yarnpkg.com/getting-started/install)\n"

if [ ! -z "$MISSING_DEPENDENCIES" ]; then
    echo -e "Missing dependencies:\n$MISSING_DEPENDENCIES"
    exit 1
fi

echo "Installing Python dependencies with Poetry..."
poetry install

echo "Building UI with Yarn..."
./scripts/build-ui.sh

echo "Running llama-cpp-python-cublas.sh to enable hardware acceleration..."
./scripts/llama-cpp-python-cublas.sh

echo "Running selfie..."

if [ "$(uname -m)" = "arm64" ]; then
    ENV_FLAG="OMP_NUM_THREADS=1 KMP_DUPLICATE_LIB_OK=TRUE"
fi

if [ ! -z "$ENV_FLAG" ]; then
    export $ENV_FLAG
fi

poetry run python -m selfie
