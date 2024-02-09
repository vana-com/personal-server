from PyInstaller.utils.hooks import collect_data_files, get_package_paths
import os, sys

# Get the package path
package_path = get_package_paths('llama_cpp')[0]

# Collect data files
datas = collect_data_files('llama_cpp')

# Append the additional .dll or .so file
if os.name == 'nt':  # Windows
    dll_path = os.path.join(package_path, 'llama_cpp', 'llama.dll')
    datas.append((dll_path, 'llama_cpp'))
elif sys.platform == 'darwin':  # Mac
    #so_path = os.path.join(package_path, 'llama_cpp', 'llama.dylib')
    so_path = os.path.join(package_path, 'llama_cpp', 'libllama.dylib')
    # so_path = os.path.join(package_path, 'llama_cpp', 'libllama.so')
    datas.append((so_path, 'llama_cpp'))
elif os.name == 'posix':  # Linux
    so_path = os.path.join(package_path, 'llama_cpp', 'libllama.so')
    datas.append((so_path, 'llama_cpp'))