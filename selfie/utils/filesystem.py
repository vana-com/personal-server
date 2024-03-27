import os
import platform


def get_app_dir(app_name, dir_name, roaming=True, log_dir=False):
    os_name = platform.system()
    if os_name == 'Darwin':
        home = os.path.expanduser('~')
        if log_dir:
            return os.path.join(home, 'Library', 'Logs', app_name, dir_name)
        return os.path.join(home, 'Library', 'Application Support', app_name, dir_name)
    elif os_name == 'Windows':
        if roaming:
            root = os.environ.get('APPDATA')
        else:
            root = os.environ.get('LOCALAPPDATA')
        if root is None:
            raise OSError("Unable to determine application data directory")
        return os.path.join(root, app_name, dir_name)
    else:
        home = os.path.expanduser('~')
        return os.path.join(home, '.' + app_name, dir_name)


def ensure_dir_exists(dir_path):
    os.makedirs(dir_path, exist_ok=True)


def get_data_dir(app_name):
    return get_app_dir(app_name, 'Data', roaming=True)


def get_log_dir(app_name):
    return get_app_dir(app_name, '', log_dir=True)


def get_data_path(app_name, file_name):
    data_dir = get_data_dir(app_name)
    ensure_dir_exists(data_dir)
    return os.path.join(data_dir, file_name)


def get_log_path(app_name, file_name):
    log_dir = get_log_dir(app_name)
    ensure_dir_exists(log_dir)
    return os.path.join(log_dir, file_name)