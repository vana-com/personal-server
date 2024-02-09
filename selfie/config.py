import os
from dotenv import load_dotenv
load_dotenv()

port = int(os.environ.get('PORT', '8181'))
ngrok_auth_token = os.environ.get('NGROK_AUTHTOKEN', None)

default_database_storage_root = os.path.join(os.path.dirname(os.path.realpath(__file__)), "../data/database")
default_embeddings_storage_root = os.path.join(os.path.dirname(os.path.realpath(__file__)), "../data/embeddings")
default_db_name = 'selfie.db'
default_local_model = 'TheBloke/Mistral-7B-Instruct-v0.2-GGUF/mistral-7b-instruct-v0.2.Q4_K_M.gguf'
default_local_gpu_model = 'TheBloke/Mistral-7B-OpenOrca-GPTQ'
default_local_functionary_model = "meetkai/functionary-7b-v2-GGUF/functionary-7b-v2.q4_0.gguf"
default_hosted_model = "openai/gpt-3.5-turbo"
