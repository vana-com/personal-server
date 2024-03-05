# Build the UI using minimalistic nodejs image and yarn
FROM node:18.19-alpine3.18 AS selfie-ui

# Set the working directory in the container
WORKDIR /selfie

# Copy the package.json and yarn.lock files
COPY selfie-ui/package.json selfie-ui/yarn.lock ./

# Install dependencies
RUN yarn install

# Copy the rest of the code
COPY selfie-ui/ .

# Build the project (if needed)
RUN yarn build

# Use the official Python image to run selfie
FROM python:3.11 as selfie

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE 1
ENV PYTHONUNBUFFERED 1

# Install libGL
RUN apt-get update && apt-get install -y \
    libgl1-mesa-glx \
    && rm -rf /var/lib/apt/lists/*

# Set the working directory
WORKDIR /selfie

# Copy code and dependencies into the docker image
COPY . .

# Copy the built UI from the previous stage
COPY --from=selfie-ui /selfie/out/ ./selfie-ui/out

# Install poetry
RUN pip install poetry --no-cache-dir

# Install dependencies
RUN poetry run poetry add colorlog

EXPOSE 8181

# Run start.sh
CMD ["/selfie/start.sh"]