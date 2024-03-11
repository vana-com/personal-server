# Build the UI
FROM node:18.19-alpine3.18 AS selfie-ui

# Set the working directory in the container
WORKDIR /selfie

# Copy the package.json and yarn.lock files
COPY selfie-ui/package.json selfie-ui/yarn.lock ./

# Install dependencies
RUN yarn install --frozen-lockfile --non-interactive

# Copy the rest of the code
COPY selfie-ui/ .

# Build the project
RUN yarn run build

# Use the official Python image with CUDA support
FROM python:3.11 as selfie

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE 1
ENV PYTHONUNBUFFERED 1

# Set the working directory
WORKDIR /selfie

# Copy code and dependencies into the docker image
COPY . .

# Copy the built UI from the previous stage
COPY --from=selfie-ui /selfie/out/ ./selfie-ui/out

# Install poetry
RUN pip install poetry --no-cache-dir

# Install dependencies
RUN poetry config virtualenvs.create false
RUN poetry update
RUN poetry install --no-interaction --no-ansi

# Run the installation script
RUN bash /selfie/scripts/llama-cpp-python-cublas.sh

EXPOSE 8181

# Run the application
CMD ["python", "-m", "selfie"]