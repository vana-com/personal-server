import base64
from io import BytesIO


def data_uri_to_string(data_uri):
    metadata, encoded = data_uri.split(',', 1)
    data = base64.b64decode(encoded)
    mime_type = metadata.split(';')[0].split(':')[1]
    with BytesIO(data) as buffer:
        content = buffer.read()
        return content.decode('utf-8')
