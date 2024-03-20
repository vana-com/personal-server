import multiprocessing
import platform
import sys
import argparse
import uvicorn
import webbrowser
import ngrok
import logging
import os
from dotenv import load_dotenv

from selfie.config import create_app_config, default_port, get_app_config
from selfie.logging import get_log_path

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)


def get_default_gpu_mode():
    os_name = platform.system()
    architecture = platform.machine()

    if os_name == 'Darwin' and architecture == 'arm64':
        return True

    return False


def serialize_args_to_env(args):
    for arg, value in vars(args).items():
        env_var = f"SELFIE_{arg.upper()}"
        os.environ[env_var] = str(value)


def deserialize_args_from_env():
    return argparse.Namespace(
        share=os.getenv('SELFIE_SHARE') == 'True',
        port=int(os.getenv('SELFIE_PORT', default_port)),
        gpu=os.getenv('SELFIE_GPU') == 'True' if os.getenv('SELFIE_GPU') is not None else get_default_gpu_mode(),
        reload=os.getenv('SELFIE_RELOAD') == 'True',
        verbose=os.getenv('SELFIE_VERBOSE') == 'True',
        headless=os.getenv('SELFIE_HEADLESS') == 'True',
    )


def parse_args():
    parser = argparse.ArgumentParser(description="Run the selfie app.")
    parser.add_argument("--share", action="store_true", help="Share the API via ngrok")
    parser.add_argument("--port", type=int, default=int(os.getenv('PORT', default_port)), help="Specify the port to run on")
    parser.add_argument("--gpu", default=get_default_gpu_mode(), action="store_true", help="Enable GPU support")
    parser.add_argument("--reload", action="store_true", help="Enable hot-reloading")
    parser.add_argument("--verbose", action="store_true", help="Enable verbose logging")
    parser.add_argument("--headless", action="store_true", help="Run in headless mode (no GUI)")
    args = parser.parse_args()
    serialize_args_to_env(args)
    return args


def get_configured_app(shareable=False):
    args = deserialize_args_from_env()

    logger.info(f"Running with args: {args}")

    if args.verbose:
        logging.getLogger("selfie").setLevel(level=logging.DEBUG)

    ngrok_auth_token = os.environ.get('NGROK_AUTHTOKEN', None)
    ngrok_domain = os.environ.get('NGROK_DOMAIN', None)

    if shareable and args.share:
        if ngrok_auth_token is None:
            raise ValueError("NGROK_AUTHTOKEN environment variable is required to share the API. Visit https://dashboard.ngrok.com to get your token.")

        listener = ngrok.forward(args.port, authtoken_from_env=True, domain=ngrok_domain)
        logger.info(f"Application is available at {listener.url()}")
        os.environ['SELFIE_HOST'] = listener.url()
        del os.environ['SELFIE_PORT']

    logger.info("Creating app configuration")

    create_app_config(**vars(args))

    # Ensure this import happens after configuration is set
    from selfie.api import app

    return app


def start_fastapi_server():
    args = deserialize_args_from_env()
    if args.reload:
        uvicorn.run("selfie.__main__:get_configured_app", host="0.0.0.0", port=args.port, reload=True, factory=True)
    else:
        fastapi_app = get_configured_app(shareable=True)

        uvicorn_log_config = uvicorn.config.LOGGING_CONFIG

        uvicorn_log_config["handlers"]["selfie"] = {
            "class": "logging.handlers.RotatingFileHandler",
            "filename": get_log_path(),
            "maxBytes": 1024*1024,
            "backupCount": 5,
            "formatter": "default",
        }

        uvicorn_log_config["formatters"]["default"] = {
            "class": "uvicorn.logging.DefaultFormatter",
            "fmt": "%(asctime)s - %(name)s - %(levelname)s - %(message)s",
            "use_colors": False,
        }

        uvicorn_log_config["formatters"]["access"] = {
            "fmt": '%(asctime)s - %(levelname)s - %(client_addr)s - "%(request_line)s" %(status_code)s',
            "datefmt": "%Y-%m-%d %H:%M:%S",
            "use_colors": False,
        }

        uvicorn_log_config["handlers"]["console"] = {
            "class": "logging.StreamHandler",
            "formatter": "default",
        }

        uvicorn_log_config["loggers"]["uvicorn"] = {
            "handlers": ["selfie", "console"],
            "level": "INFO",
            "propagate": False,
        }

        uvicorn_log_config["loggers"]["uvicorn.*"] = {
            "handlers": ["selfie", "console"],
            "level": "INFO",
            "propagate": False,
        }
        # Start Uvicorn with the modified log config
        uvicorn.run(fastapi_app, host="0.0.0.0", port=args.port, log_config=uvicorn_log_config)


def main():
    load_dotenv()  # Load environment variables
    args = parse_args()

    if args.headless:
        start_fastapi_server()
    else:
        from selfie.gui import SystemTrayApp
        system_tray_app = SystemTrayApp(sys.argv)
        sys.exit(system_tray_app.exec())  # Start the PyQt application event loop


if __name__ == "__main__":
    multiprocessing.freeze_support()
    multiprocessing.set_start_method('spawn')
    main()
