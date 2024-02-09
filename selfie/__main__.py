import uvicorn
import sys
import webbrowser
import ngrok
import logging
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

from selfie.api import app
from selfie.config import port, ngrok_auth_token

@app.on_event("startup")
async def on_startup():
    webbrowser.open(f"http://localhost:{port}")

    if "share" in sys.argv:
        if ngrok_auth_token is None:
            raise ValueError("NGROK_AUTHTOKEN environment variable is required to share the API. Visit https://dashboard.ngrok.com/ to get your token.")
        listener = await ngrok.forward(port, authtoken_from_env=True)
        logger.info(f"API available at {listener.url()}")


@app.on_event("shutdown")
def on_shutdown():
    ngrok.disconnect()


# Uncomment this for hot-reloading
#uvicorn.run("selfie.api:app", host="0.0.0.0", port=port, reload=True)
uvicorn.run(app, host="0.0.0.0", port=port)
