from PyInstaller.utils.hooks import collect_submodules
hiddenimports = collect_submodules('skl2onnx')
module_collection_mode = 'pyz+py'
