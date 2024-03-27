import logging
from logging.handlers import RotatingFileHandler

from selfie.utils.filesystem import get_log_path as fs_get_log_path

# TODO: Don't hardcode these
level = logging.INFO
log_file = "selfie.log"


def get_log_path():
    return fs_get_log_path('Selfie', log_file)


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
