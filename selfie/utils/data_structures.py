import base64
from io import BytesIO


def data_uri_to_dict(data_uri):
    metadata, encoded = data_uri.split(',', 1)
    metadata = metadata.split(';')
    mime_type = metadata[0].split(':')[1]
    attributes = {}
    for attr in metadata[1:]:
        if "=" in attr:
            key, value = attr.split('=')
            attributes[key] = value
        else:
            attributes[attr] = None

    return {
        "content": base64.b64decode(encoded).decode('utf-8'),
        "content_type": mime_type,
        **attributes
    }


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
