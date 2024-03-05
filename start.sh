#!/bin/bash

# Flags to optionally skip dependencies and build, used for docker multi-stage builds
SKIP_DEPS=false
SKIP_BUILD=false

# Parse flags
for arg in "$@"
do
    case $arg in
        --skip-deps)
        SKIP_DEPS=true
        shift # Remove --skip-deps from processing
        ;;
        --skip-build)
        SKIP_BUILD=true
        shift # Remove --skip-build from processing
        ;;
        *)
        # Unknown option
        ;;
    esac
done

if [ ! -f "selfie/.env" ]; then
    echo "Copying selfie/.env.example to selfie/.env..."
    cp selfie/.env.example selfie/.env
else
    echo "selfie/.env already exists. Skipping copy."
fi

if [ "$SKIP_DEPS" = false ]; then
    MISSING_DEPENDENCIES=""
    command -v python >/dev/null 2>&1 || MISSING_DEPENDENCIES="${MISSING_DEPENDENCIES} Python (https://www.python.org/downloads/)\n"
    command -v poetry >/dev/null 2>&1 || MISSING_DEPENDENCIES="${MISSING_DEPENDENCIES} Poetry (https://python-poetry.org/docs/#installation)\n"
    command -v yarn >/dev/null 2>&1 || MISSING_DEPENDENCIES="${MISSING_DEPENDENCIES} Yarn (https://yarnpkg.com/getting-started/install)\n"

    if [ ! -z "$MISSING_DEPENDENCIES" ]; then
        echo -e "Missing dependencies:\n$MISSING_DEPENDENCIES"
        exit 1
    fi
else
    echo "Skipping dependency checks..."
fi

echo "Installing Python dependencies with Poetry including dev..."
poetry check || poetry install --with dev

if [ "$SKIP_BUILD" = false ]; then
    echo "Building UI with Yarn..."
    ./scripts/build-ui.sh
else
    echo "Skipping UI build..."
fi

ACCELERATION_FLAG=""

echo "Running llama-cpp-python-cublas.sh to enable hardware acceleration..."
./scripts/llama-cpp-python-cublas.sh

LLAMA_CPP_VERSION=$(poetry run pip list --format=freeze | grep "llama_cpp_python==" | cut -d'=' -f3)

if [[ $LLAMA_CPP_VERSION == *"-gpu"* ]]; then
    echo "Accelerated version of llama_cpp_python detected. Enabling GPU support."
    ACCELERATION_FLAG="--gpu"
else
    echo "No accelerated version of llama_cpp_python detected. Running without GPU support."
fi

echo "Running selfie..."
poetry run python -m selfie $ACCELERATION_FLAG
