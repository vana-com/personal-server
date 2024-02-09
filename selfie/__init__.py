import logging
import warnings
from llama_index.llms import litellm
import colorlog

# Suppress specific warnings
# TODO: Not sure why these aren't quite working
warnings.filterwarnings("ignore", category=DeprecationWarning)
warnings.filterwarnings("ignore", category=UserWarning)
warnings.filterwarnings("ignore")

handler = colorlog.StreamHandler()
handler.setFormatter(colorlog.ColoredFormatter())
logging.root.addHandler(handler)

logging.basicConfig(level=logging.INFO)
logging.getLogger("selfie").setLevel(level=logging.DEBUG)


litellm.drop_params = True
