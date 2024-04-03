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

from selfie.config import create_app_config, default_port
from selfie.logging import get_log_path

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)


def serialize_args_to_env(args):
    for arg, value in vars(args).items():
        if value is not None:
            os.environ[f"SELFIE_{arg.upper()}"] = str(value)


def deserialize_args_from_env():
    # Common lambda for boolean conversion
    to_bool = lambda v: v.lower() == 'true'

    # Environment variable mappings with optional defaults
    env_vars = {
        'ngrok_enabled': ('SELFIE_NGROK_ENABLED', to_bool),
        'api_port': ('SELFIE_API_PORT', int),
        'gpu': ('SELFIE_GPU', to_bool),
        'reload': ('SELFIE_RELOAD', to_bool),
        'verbose_logging': ('SELFIE_VERBOSE_LOGGING', to_bool),
        'headless': ('SELFIE_HEADLESS', to_bool),
        'model': ('SELFIE_MODEL', str),
    }

    args = {}
    for arg, (env_var, convert) in env_vars.items():
        value = os.getenv(env_var)
        if value is not None:
            args[arg] = convert(value)

    class FallbackToNoneNamespace(argparse.Namespace):
        def __getattr__(self, name):
            if name in self.__dict__:
                return self.__dict__[name]
            return None

    return FallbackToNoneNamespace(**args)


def parse_args():
    # TODO: Update these to sync with the configuration
    parser = argparse.ArgumentParser(description="Run the selfie app.")
    # Set all defaults to None, so that we can check if they were set by the user
    # Defaults will be set in the configuration
    parser.add_argument("--ngrok_enabled", action="store_true", default=None, help="Share the API via ngrok, requires token to be set")
    parser.add_argument("--api_port", type=int, default=None, help="Specify the port to run on")
    parser.add_argument("--gpu", default=None, action="store_true", help="Enable GPU support")
    parser.add_argument("--reload", action="store_true", default=None, help="Enable hot-reloading")
    parser.add_argument("--verbose_logging", action="store_true", default=None, help="Enable verbose logging")
    parser.add_argument("--headless", action="store_true", default=None, help="Run in headless mode (no GUI)")
    parser.add_argument("--model", type=str, default=None, help="Specify the model to use")
    args = parser.parse_args()
    serialize_args_to_env(args)
    return args


def get_configured_app(shareable=False):
    args = deserialize_args_from_env()

    logger.info(f"Running with args: {args}")

    if 'verbose_logging' in args and args.verbose_logging:
        logging.getLogger("selfie").setLevel(level=logging.DEBUG)

    logger.info("Creating app configuration")
    app_config = create_app_config(**vars(args))

    if app_config.verbose_logging:
        logging.getLogger("selfie").setLevel(level=logging.DEBUG)

    if shareable and app_config.ngrok_enabled:
        if app_config.ngrok_authtoken is None:
            raise ValueError("ngrok_authtoken is required to share the API.")

        listener = ngrok.forward(app_config.api_port, authtoken=app_config.ngrok_authtoken, domain=app_config.ngrok_domain)
        logger.info(f"Application is available at {listener.url()}")
        # TODO: The idea was that these values could be used elsewhere in the app, but now that these values are synced with the database, this doesn't work. Figure out a way to make this work.
        # os.environ["SELFIE_HOST"] = listener.url()
        # del os.environ["SELFIE_API_PORT"] if "SELFIE_API_PORT" in os.environ else None
    elif app_config.ngrok_enabled:
        logger.warning("ngrok_enabled is set but ngrok_authtoken is not set. Disabling ngrok.")

    # Ensure this import happens after configuration is set
    from selfie.api import app

    return app


def start_fastapi_server():
    args = deserialize_args_from_env()
    host = "0.0.0.0"
    port = args.api_port or default_port

    if not args.headless and args.reload:
        logger.warning("Reloading is only supported in --headless mode. Disabling reload.")

    if args.headless and args.reload:
        uvicorn.run("selfie.__main__:get_configured_app", host=host, port=port, factory=True, reload=True)
    else:
        fastapi_app = get_configured_app(shareable=True)

        uvicorn_log_config = uvicorn.config.LOGGING_CONFIG

        uvicorn_log_config["handlers"]["selfie"] = {
            "class": "logging.handlers.RotatingFileHandler",
            "filename": get_log_path(),
            "maxBytes": 1024*1024,
            "backupCount": 5,
            "formatter": "default",
            "level": "DEBUG",
        }

        uvicorn_log_config["handlers"]["console"] = {
            "class": "logging.StreamHandler",
            "formatter": "default",
        }

        uvicorn_log_config["formatters"]["default"] = {
            "fmt": "%(asctime)s - %(name)s - %(levelname)s - %(message)s",
            "datefmt": "%Y-%m-%d %H:%M:%S",
            "use_colors": False,
        }

        uvicorn_log_config["formatters"]["access"] = {
            "fmt": '%(asctime)s - %(levelname)s - %(client_addr)s - "%(request_line)s" %(status_code)s',
            "datefmt": "%Y-%m-%d %H:%M:%S",
            "use_colors": False,
        }



        uvicorn_log_config["loggers"]["uvicorn"] = {
            "handlers": ["selfie", "console"],
            "level": "DEBUG",
            "propagate": False,
        }

        uvicorn_log_config["loggers"]["uvicorn.error"] = {
            "handlers": ["selfie", "console"],
            "level": "DEBUG",
            "propagate": False,
        }

        uvicorn_log_config["loggers"]["uvicorn.access"] = {
            "handlers": ["selfie", "console"],
            "level": "DEBUG",
            "propagate": False,
            "formatter": "access",
        }

        # Start Uvicorn with the modified log config
        # TODO: this log_config does not seem to write all uvicorn logs in selfie.log
        uvicorn.run(fastapi_app, host=host, port=port, log_config=uvicorn_log_config)


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
