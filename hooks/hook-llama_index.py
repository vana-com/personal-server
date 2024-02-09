from PyInstaller.utils.hooks import collect_data_files, get_package_paths
import os

# Get the package path
package_path = get_package_paths("llama_index")[0]

# Collect data files
datas = collect_data_files("llama_index")
datas.append((os.path.join(package_path, "*"), "llama_index/"))
