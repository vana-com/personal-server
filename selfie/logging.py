import os
import logging
import platform
from logging.handlers import RotatingFileHandler

# TODO: Don't hardcode these
level = logging.INFO
log_file = "selfie.log"


def get_log_path():
    os_name = platform.system()

    # Set default log directory based on the operating system
    if os_name == 'Darwin':  # macOS
        log_directory = os.path.expanduser('~/Library/Logs/Selfie')
    elif os_name == 'Windows':
        log_directory = os.path.join(os.environ['APPDATA'], 'Selfie', 'Logs')
    else:  # Assume Linux/Unix
        log_directory = os.path.expanduser('~/Selfie/Logs')

    if not os.path.exists(log_directory):
        os.makedirs(log_directory)

    return os.path.join(log_directory, log_file)


def setup_logging():
    log_path = get_log_path()

    logger = logging.getLogger()
    logger.setLevel(level)

    file_handler = RotatingFileHandler(log_path, maxBytes=1024*1024, backupCount=5)
    file_handler.setLevel(level)
    formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
    file_handler.setFormatter(formatter)

    logger.addHandler(file_handler)


setup_logging()
