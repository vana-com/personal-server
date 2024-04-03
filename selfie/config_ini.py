import os
import configparser
from selfie.utils.filesystem import get_data_path


def load_config():
    config = configparser.ConfigParser()

    # Set default values
    config['database'] = {
        'storage_root': get_data_path('Selfie', 'database'),
        'db_name': 'selfie.db',
    }
    config['embeddings'] = {
        'storage_root': get_data_path('Selfie', 'embeddings'),
    }

    # Read the config file if it exists
    config_path = os.path.join(os.path.dirname(__file__), 'config.ini')
    if os.path.exists(config_path):
        config.read(config_path)

    return config
