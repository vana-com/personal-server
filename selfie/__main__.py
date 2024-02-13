import argparse
import uvicorn
import webbrowser
import ngrok
import logging
import os
from dotenv import load_dotenv

from selfie.config import create_app_config, default_port, get_app_config

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)


def serialize_args_to_env(args):
    for arg, value in vars(args).items():
        env_var = f"SELFIE_{arg.upper()}"
        os.environ[env_var] = str(value)


def deserialize_args_from_env():
    return argparse.Namespace(
        share=os.getenv('SELFIE_SHARE') == 'True',
        port=int(os.getenv('SELFIE_PORT', default_port)),
        gpu=os.getenv('SELFIE_GPU') == 'True',
        reload=os.getenv('SELFIE_RELOAD') == 'True',
        verbose=os.getenv('SELFIE_VERBOSE') == 'True',
    )


def parse_args():
    if os.getenv('SELFIE_RELOAD') == 'True':
        return deserialize_args_from_env()
    else:
        parser = argparse.ArgumentParser(description="Run the selfie app.")
        parser.add_argument("--share", action="store_true", help="Share the API via ngrok")
        parser.add_argument("--port", type=int, default=int(os.getenv('PORT', default_port)), help="Specify the port to run on")
        parser.add_argument("--gpu", action="store_true", help="Enable GPU support")
        parser.add_argument("--reload", action="store_true", help="Enable hot-reloading")
        parser.add_argument("--verbose", action="store_true", help="Enable verbose logging")
        args = parser.parse_args()
        serialize_args_to_env(args)
        return args


def get_configured_app(shareable=False):
    args = parse_args()

    if args.verbose:
        logging.getLogger("selfie").setLevel(level=logging.DEBUG)

    ngrok_auth_token = os.environ.get('NGROK_AUTHTOKEN', None)

    if shareable and args.share:
        if ngrok_auth_token is None:
            raise ValueError("NGROK_AUTHTOKEN environment variable is required to share the API. Visit https://dashboard.ngrok.com to get your token.")

        listener = ngrok.forward(args.port, authtoken_from_env=True)
        logger.info(f"Application is available at {listener.url()}")
        # Update config directly as modifying args won't affect the env vars
        os.environ['SELFIE_HOST'] = listener.url()
        del os.environ['SELFIE_PORT']

    create_app_config(**vars(args))

    # Ensure this import happens after configuration is set
    from selfie.api import app
    return app


def main():
    args = parse_args()

    if args.reload:
        if args.share:
            raise ValueError("Reloading with sharing enabled is not supported.")
        uvicorn.run("selfie.__main__:get_configured_app", host="0.0.0.0", port=args.port, reload=True, factory=True)
    else:
        app = get_configured_app(shareable=True)

        @app.on_event("startup")
        async def on_startup():
            webbrowser.open(get_app_config().base_url)

        @app.on_event("shutdown")
        async def on_shutdown():
            ngrok.disconnect()

        uvicorn.run(app, host="0.0.0.0", port=args.port)


if __name__ == "__main__":
    load_dotenv()
    main()
