import base64
from io import BytesIO


def data_uri_to_string(data_uri):
    metadata, encoded = data_uri.split(',', 1)
    data = base64.b64decode(encoded)
    mime_type = metadata.split(';')[0].split(':')[1]
    with BytesIO(data) as buffer:
        content = buffer.read()
        return content.decode('utf-8')


def check_nested(obj, *keys):
    """
    Recursively check if nested keys exist in a dictionary.
    """
    for key in keys:
        try:
            obj = obj[key]
        except (KeyError, TypeError):
            return False
    return True
