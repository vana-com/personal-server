import os

import selfie.logging

import logging
import warnings
import colorlog

from selfie.utils.filesystem import get_nltk_dir, get_tiktoken_dir

# Override the data dir for nltk as LlamaIndex chooses a write-protected directory (https://github.com/run-llama/llama_index/blob/v0.10.26/llama-index-core/llama_index/core/utils.py#L47)
# https://github.com/nltk/nltk/blob/3.8.1/web/data.rst
os.environ["NLTK_DATA"] = get_nltk_dir("Selfie")
os.environ["TIKTOKEN_CACHE_DIR"] = get_tiktoken_dir("Selfie")
# LiteLLM doesn't (yet?) respect the TIKTOK_CACHE_DIR environment variable
# Source: https://github.com/BerriAI/litellm/pull/1947, with the latest code here: https://github.com/BerriAI/litellm/blob/main/litellm/utils.py
# Now we can safely import litellm
import litellm

# Suppress specific warnings
# TODO: Not sure why these aren't quite working
warnings.filterwarnings("ignore", category=DeprecationWarning)
warnings.filterwarnings("ignore", category=UserWarning)
warnings.filterwarnings("ignore")

handler = colorlog.StreamHandler()
handler.setFormatter(colorlog.ColoredFormatter())
logging.root.addHandler(handler)

logging.basicConfig(level=logging.INFO)
logging.getLogger("selfie").setLevel(level=logging.INFO)

litellm.drop_params = True
