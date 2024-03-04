<div align="center">
  <img alt="selfie" src="./docs/images/hero.png" height="300px">
  <br>
  <a href="https://discord.gg/GhYDaDqENx" target="_blank"><img alt="selfie" src="https://dcbadge.vercel.app/api/server/GhYDaDqENx?style=flat&compact=true"></a>

[//]: # (  <a href="https://vana.com/" target="_blank"><img alt="selfie" src="https://assets-global.website-files.com/62dfa5318bb52f5fea8dc489/62dfb34210f09278d8bce721_Vana_Logo.svg" style="background-color: #dbff00; padding: 5px; height: 20px; border-radius: 2px"></a>)
</div>

# Selfie

[Jump to Quick Start](#quick-start)

Bring your personal data to life! Selfie offers OpenAI-compatible APIs that bring your data into LLM awareness. Selfie also empowers you to directly search your data with natural language. Selfie runs 100% locally by default to keep your data private.

## Features

* Mix your data into text completions using OpenAI-compatible clients like [OpenAI SDKs](https://platform.openai.com/docs/libraries) and [SillyTavern](https://sillytavernai.com).
* Quickly drop in any text file, with enhanced support for conversations exported from messaging platforms.
* Runs locally by default to keep your data private.
* Hosted LLMs from OpenAI, Replicate, etc. are supported too.
* APIs for directly and selectively querying your data in natural language.

### Personalized Chat 

<img alt="selfie-augmentation" src="./docs/images/playground-use-data.png" height="300px">

### Natural Search

<img alt="selfie-search" src="./docs/images/playground-search.png" height="250px">

### API Support

```bash
curl -X POST 'http://localhost:8181/v1/chat/completions' \
-H 'Content-Type: application/json' \
-d '{
  "messages": [{"role": "user", "content": "As Alice, what is your proudest garden achievement?"}]
}' | jq '.choices[0].message.content'

# "I grew a 10-pound tomato!"
```

[Jump to API Usage](#api-usage-guide)

[//]: # (TODO: build out integration recipes)
[//]: # (*Check out [Integration Recipes]&#40;#integration-recipes&#41; for some example of what you can do with Selfie.*)

[//]: # (* Load data using any [LlamaHub loader]&#40;https://llamahub.ai/?tab=loaders&#41;.)
[//]: # (* Easy deployment with Docker and pre-built executables.)

## Quick Start

1. Install [python](https://www.python.org) 3.9+, [poetry](https://python-poetry.org), and [Node.js](https://nodejs.org).
2. Clone or [download](https://github.com/vana-com/selfie/archive/refs/heads/main.zip) the repository.
3. Run `start.sh`.
4. http://localhost:8181 will open in your default web browser.

> **Tip**: Python 3.11 is recommended.

> **Tip**: On macOS you can run `brew install poetry nodejs` with [brew](https://brew.sh).

## Overview

Selfie is designed to compose well with tools on both sides of the text generation process. You can think of it as middleware that intelligently mixes your data into a request.

A typical request:
```
Application -(request)-> LLM
```

A request through Selfie:
```
Application -(request)-> Selfie -(request x data)-> LLM
                            |
                        Your Data
```

On the application side, Selfie exposes text generation APIs, including OpenAI-compatible endpoints.

On the LLM side, Selfie uses tools like LiteLLM and txtai to support forwarding data-augmented requests to your LLM of choice


## Installation

For most users, the easiest way to install Selfie is to follow the [Quick Start](#quick-start) instructions. If that doesn't work, or if you just want to install Selfie manually, follow the detailed instructions below.

<details>
<summary>Manual Installation</summary>

1. Ensure that [python](https://www.python.org) 3.9+, [poetry](https://python-poetry.org), and [Node.js](https://nodejs.org) are installed.
2. Clone or [download](https://github.com/vana-com/selfie/archive/refs/heads/main.zip) the repository.
3. In a terminal, navigate to the project directory.
4. Run `cp selfie/.env.example selfie/.env` to create a `.env` file in which you can configure the default port that Selfie runs on and hosting with ngrok.
5. Run `./scripts/build-ui.sh` to build the UI and copy it to the server.
6. Run `poetry install` to install required Python dependencies.
7. Optional: Run `./scripts/llama-cpp-python-cublas.sh` to enable hardware acceleration (for details, see [Scripts](#llama-cpp-python-cublassh)).
8. Run `poetry run python -m selfie`, or `poetry run python -m selfie --gpu` if your device is GPU-enabled. The first time you run this, it will download ~4GB of model weights.

[//]: # (1. `git clone
[//]: # (Disable this note about installing with GPU support until supported via transformers, etc.)
[//]: # (3. `poetry install` or `poetry install -E gpu` &#40;to enable GPU devices via transformers&#41;. Enable GPU or Metal acceleration via llama.cpp by installing GPU-enabled llama-cpp-python, see Scripts.)

[//]: # (This starts a local web server and should launch the UI in your browser at http://localhost:8181. API documentation is available at http://localhost:8181/docs. Now that the server is running, you can use the API to import your data and connect to your LLM.)
</details>

> **Note**: You can host selfie at a publicly-accessible URL with [ngrok](https://ngrok.com). Add your ngrok token (and optionally, ngrok domain) in `selfie/.env` and run `poetry run python -m selfie --share`.


## Setting Up Selfie

Selfie comes with a web-based UI that you can use to import your data and interact with it.

### Import Your Data

Selfie supports importing text data, with special processing for certain data formats, like chat logs from WhatsApp and ChatGPT.

> **Note**: You can try the example files in the `example-chats` directory if you want to try a specific data format that you don't have ready for import.

To import data into Selfie:

1. **Open the Add Data Page**: Access the UI and locate the Add Data section.
2. **Select Data Source**: Choose the type of data you are uploading (e.g., WhatsApp, Text Files). Choose the type that most closely matches your data format.
3. **Configure and Submit**: Complete the required fields and submit the form.

Support for new types of data can be added by creating new data connectors in `selfie/connectors/` (instructions [here](./selfie/connectors/README.md), please contribute!).

> **Note**: Ensure you obtain consent from participants in the chats you wish to export.

### Interact With Your Data

Now you are ready to interact with your data!

The Playground page includes a chat interface and a search feature. Write an LLM persona by entering a name and bio, and try interacting with your data through conversation. You can also search your data for specific topics under Search.

Now you are ready to use the Selfie API!

## API Usage Guide

To quickly see your API in action, try viewing this link in your web browser:

http://localhost:8181/v1/index_documents/summary?topic=travel.

Detailed API documentation is available [here](http://localhost:8181/docs).

### How Text Completions Work

By default, Selfie augments text completions with local models using llama.cpp and a local txtai embeddings database.

OpenAI-supported parameters like `messages`, `temperature`, `max_tokens`, etc., should all work out of the box, with some special considerations:

* `model` should be a local path, HuggingFace model name, or LiteLLM model name, depending on the method you choose.

You can also include special parameters to direct Selfie in how your request should be handled:

* `method`: The method to use for text generation. Options are `llama.cpp` for running local model files directly (e.g., `.gguf` files), and `litellm` for everything else.
* `api_base`: The base URL of an OpenAI-compatible API to use for text generation, e.g. if you want to host a local model with another tool.
* `api_key`: The API key required by your API at `api_base`.
* `disable_augmentation`: Set to `true` to generate text without data augmentation.

Examples and more details are provided in the next sections.

### Using Selfie With Local Models

Selfie uses [txtai](https://neuml.github.io/txtai) to download local models and run them with [llama.cpp](https://github.com/ggerganov/llama.cpp). In completion requests, specify the `llama.cpp` method, or leave it off as the default, and ensure that your model is defined correctly, as a local path or HuggingFace model, according to [txtai's documentation](https://neuml.github.io/txtai/models).

```json
{
  "prompt": "What is the meaning of life?",
  "method": "llama.cpp",
  "model": "~/models/dolphin-2.6-mistral-7b-dpo.Q5_K_M.gguf"
}
```
or
```json
{
  "prompt": "What is the meaning of life?",
  "method": "llama.cpp",
  "model": "TheBloke/dolphin-2.6-mistral-7B-dpo-GGUF/dolphin-2.6-mistral-7b-dpo.Q5_K_M.gguf"
}
```
You can even use a local Open-AI compatible API ([LiteLLM OpenAI-Compatible Endpoints docs](https://litellm.vercel.app/docs/providers/openai_compatible)).
```json
{
  "method": "litellm",
  "api_base": "http://localhost:5000/v1",
  "api_key": "none"
}
```
Method is optional and defaults to `litellm` when `api_base` is specified.

### Using Selfie with Hosted Models

Selfie can use hosted model providers through [litellm](https://litellm.vercel.app). In completion requests, specify the `litellm` method (optional) and ensure that your model is prefixed correctly according to [litellm's documentation for your provider](https://docs.litellm.ai/docs/providers).

```json
{
  "method": "litellm",
  "model": "replicate/llama-2-70b-chat:2796ee9483c3fd7aa2e171d38f4ca12251a30609463dcfd4cd76703f22e96cdf"
}
```

In general, you need an API key for your provided loaded into your environment. A quick way to do that is to specify it when you start the server:
`REPLICATE_API_KEY=replicatekey python -m selfie`.

### Vanilla Text Generation

Add `disable_augmentation: true` to your request body to generate text without data augmentation.

```json
{
  "prompt": "What is the meaning of life?",
  "method": "llama.cpp",
  "model": "~/models/dolphin-2.6-mistral-7b-dpo.Q5_K_M.gguf",
  "disable_augmentation": true
}
```

## Integration Recipes

Selfie can be used to augment text generation in a variety of applications. Here are some examples.

### Powering the OpenAI SDK

The OpenAI SDK is a popular way to access OpenAI's text generation models. You can use Selfie to augment the text completions that the SDK generates simply by setting the `apiBase` and `apiKey` parameters.

```js
import OpenAI from 'openai';

const openai = new OpenAI({
  baseURL: 'http://localhost:8181/v1',
  apiKey: ''
});

const chatCompletion = await openai.chat.completions.create({
  messages: [
    { role: 'system', content: `Write Alice's next reply.` },
    { role: 'user', content: 'What are your favorite snacks?' },
  ]
});

console.log(chatCompletion.choices[0].message.content);

// "I enjoy Bahn Mi and Vietnamese coffee."
```

### Powering SillyTavern

[SillyTavern](https://sillytavernai.com) is a self-hosted application that allows you to chat/roleplay with characters that you create. You can use Selfie to give SillyTavern characters some awareness of your data.

1. Install and run [SillyTavern](https://github.com/SillyTavern/SillyTavern).
2. Configure a custom chat completion source as  `http://localhost:8181`. You can customize the model by setting API parameters for `method` and `model` in Additional Parameters. \
   ![silly-tavern-api.png](docs/images/silly-tavern-api.png)
3. Create a character, customize the text generation settings, etc.
4. Chat with your character to see that it is aware of your data: \
   ![silly-tavern-chat.png](docs/images/silly-tavern-chat.png)

You can even tell Selfie to use an OpenAI-compatible API for the LLM that it augments:

Note that model is empty:
![silly-tavern-local-api-model.png](docs/images/silly-tavern-local-api-model.png)
We pass an extra parameter, `instruct_mode`, for text-generation-webui.
![silly-tavern-local-api.png](docs/images/silly-tavern-local-api.png)

> **Note**: some OpenAI-compatible APIs may not properly handle SillyTavern's use of multiple system messages and non-alternating user/assistant messages (like [text-generation-webui](https://github.com/oobabooga/text-generation-webui)). A text-generation-webui workaround is described [here](https://github.com/SillyTavern/SillyTavern/issues/1722#issuecomment-1902619716).

## Scripts

The `scripts` directory contains a variety of scripts for setting up Selfie. Here's a brief overview of each script:

### build-ui.sh

To build the UI, run `./scripts/build-ui.sh`.

### llama-cpp-python-cublas.sh

To install llama.cpp with hardware acceleration for better performance, run `./scripts/llama-cpp-python-cublas.sh`.

Alternatively, you can build `llama-cpp-python` manually with the flags of your choice by following [the instructions](https://github.com/abetlen/llama-cpp-python?tab=readme-ov-file#installation).

## Experimental Features

Selfie is a work in progress. Here are some features that are not yet fully supported.

### Building an Executable

To build an executable for your platform:

1. Run `pip install pyinstaller`. *(pyinstaller is not compatible with Python >3.12 so it is not included by default)*
2. Run `pyinstaller selfie.spec --noconfirm`.
3. Start the built service with `./dist/selfie/selfie`.

## Contributing

Selfie is a community project. We welcome contributions of all kinds, including bug reports, feature requests, and pull requests. Please see the [contributing guide](CONTRIBUTING.md) for more information.

## Community

Join the [Vana Discord server](https://discord.gg/GhYDaDqENx) to chat with the community and get help with Selfie.
