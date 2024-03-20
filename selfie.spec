# -*- mode: python ; coding: utf-8 -*-

# Run poetry shell, then pyinstaller cli.spec --noconfirm

import os

def collect_connector_files(base_path):
    data_files = []
    for root, dirs, files in os.walk(base_path):
        for file in files:
            if file.endswith('.py'):
                continue
            file_path = os.path.join(root, file)
            relative_path = os.path.relpath(root, base_path)
            destination_path = os.path.join('selfie/connectors', relative_path)
            data_files.append((file_path, destination_path))
    return data_files


connector_files = collect_connector_files('./selfie/connectors/')

a = Analysis(
    ['selfie/__main__.py'],
    debug=True,
    pathex=[os.path.abspath(SPECPATH)],
    binaries=[],
    datas=[
        ('./selfie/parsers/chat/blacklist_patterns.yaml', 'selfie/parsers/chat/'),
        ('./selfie/web/', 'selfie/web/'),
        ('./selfie/images/', 'selfie/images/'),
        *connector_files,
    ],
    hiddenimports=[
        'tiktoken_ext',
        'tiktoken_ext.openai_public',
        'onnxconverter_common', # Logs say hidden import 'onnxconverter_common' not found
        'llama_index',
    ],
    hookspath=['./hooks'],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    module_collection_mode={
        'onnxconverter_common': 'pyz+py',
    },
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='selfie',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='selfie',
    debug="all",
)

app = BUNDLE(coll,
    name='Selfie.app',
    icon='Selfie.icns',
    bundle_identifier='com.vana.selfie',
)
