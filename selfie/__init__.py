import selfie.logging

import logging
import warnings
import colorlog

### Preemptive fix based on suggestion in https://github.com/BerriAI/litellm/issues/2607
# import platform
# import os
#
# os_name = platform.system()
#
# if os_name == 'Darwin':  # macOS
#     cache_dir = os.path.expanduser('~/Library/Caches/TikToken')
# elif os_name == 'Windows':
#     cache_dir = os.path.join(os.environ['APPDATA'], 'TikToken', 'Cache')
# else:  # Assume Linux/Unix
#     cache_dir = os.path.expanduser('~/TikToken/Cache')
#
# # LiteLLM writes to a read-only directory in the built application bundle, try to override it
# # Source: https://github.com/BerriAI/litellm/pull/1947, with the latest code here: https://github.com/BerriAI/litellm/blob/main/litellm/utils.py
# os.environ['TIKTOKEN_CACHE_DIR'] = cache_dir
#
# # Now we can safely import litellm
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
