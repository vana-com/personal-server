import os
import platform


def get_system_path(app_name, dir_name, path_type='data'):
    """
    Generates paths for app data, caches, and logs based on the operating system.

    Args:
        app_name (str): The application's name, part of the path.
        dir_name (str): The specific directory name for the data.
        path_type (str): The type of path ('data', 'cache', 'logs').

    Returns:
        str: The constructed path.
    """
    os_name = platform.system()
    paths_config = {
        'Darwin': {
            'base': os.path.expanduser('~'),
            'sub': {
                'data': ['Library', 'Application Support'],
                'cache': ['Library', 'Caches'],
                'logs': ['Library', 'Logs'],
            }
        },
        'Windows': {
            'base': {
                'data': os.environ.get('APPDATA'),
                'cache': os.environ.get('LOCALAPPDATA'),
                'logs': os.environ.get('LOCALAPPDATA'),
            },
            'sub': {
                'data': [],
                'cache': ['Cache'],
                'logs': ['Logs'],
            }
        },
        'Linux': {
            'base': os.path.expanduser('~'),
            'sub': {
                'data': ['.' + app_name],
                'cache': ['.' + app_name, 'cache'],
                'logs': [app_name, 'logs'],
            }
        }
    }

    config = paths_config.get(os_name, paths_config['Linux'])  # Default to Linux for unknown OS
    base_path = config['base'][path_type] if isinstance(config['base'], dict) else config['base']
    sub_path = config['sub'][path_type] + [app_name, dir_name] if path_type in ['data', 'logs'] else config['sub'][path_type] + [dir_name]

    if base_path is None:
        raise OSError(f"Unable to determine base path for {path_type} on {os_name}.")

    constructed_path = os.path.join(base_path, *sub_path)
    normalized_path = os.path.normpath(constructed_path)

    return normalized_path


def ensure_dir_exists(dir_path):
    os.makedirs(dir_path, exist_ok=True)


def get_nltk_dir(app_name):
    return get_system_path(app_name, "nltk_data", path_type='cache')


def get_tiktoken_dir(app_name):
    return get_system_path(app_name, "tiktoken_cache", path_type='cache')


def get_data_dir(app_name):
    return get_system_path(app_name, 'data')


def get_log_dir(app_name):
    return get_system_path(app_name, '', path_type='logs')


def get_data_path(app_name, file_name):
    data_dir = get_data_dir(app_name)
    ensure_dir_exists(data_dir)
    return os.path.join(data_dir, file_name)


def get_log_path(app_name, file_name):
    log_dir = get_log_dir(app_name)
    ensure_dir_exists(log_dir)
    return os.path.join(log_dir, file_name)


def resolve_path(path):
    """Expand user directory (~), resolve to absolute path, and follow symlinks."""
    return os.path.realpath(os.path.abspath(os.path.expanduser(path)))
