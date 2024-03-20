import logging
from logging.handlers import RotatingFileHandler

log_file = "selfie.log"  # TODO: Don't hardcode the log file
file_handler = RotatingFileHandler(log_file, maxBytes=1024*1024, backupCount=5)
file_handler.setFormatter(logging.Formatter("%(asctime)s - %(name)s - %(levelname)s - %(message)s"))
logging.root.addHandler(file_handler)
