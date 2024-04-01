import React, { useEffect, useState } from "react";
import TailwindForm from "../../components/rjsf";
import validator from '@rjsf/validator-ajv8';
import { apiBaseUrl } from "@/app/config";


const Settings = () => {
  const [settings, setSettings] = useState({});
  const [models, setModels] = useState({ data: [] });

  const schema = {
    // title: "Settings",
    description: "Configure your application settings.",
    type: "object",
    required: ["method"],
    properties: {
      method: {
        type: "string",
        title: "LLM provider",
        enum: ["llama.cpp", "litellm"],
        enumNames: ['Local (llama.cpp)', 'Other (litellm)'],
        default: "llama.cpp"
      },
      // name: { type: "string", title: "Name" },
      // description: { type: "string", title: "Description" },
      // apiKey: { type: "string", title: "API Key" },
      // host: { type: "string", title: "Host", default: "http://localhost" },
      // port: { type: "integer", title: "Port", default: 8000 },
      // share: { type: "boolean", title: "Share", default: false },
      // verbose: { type: "boolean", title: "Verbose", default: false },
    },
    allOf: [
      {
        if: {
          properties: {
            method: {
              title: "Local",
              description: "Local",
              const: "llama.cpp",
              label: "ugh"
            }
          },
        },
        then: {
          properties: {
            gpu: {
              type: "boolean",
              title: "GPU mode (check this if you have an Nvidia GPU or ARM Apple CPU for improved performance)",
              default: false
            },
            model: {
              // anyOf: [
                // ...[models.data.length && {
                // {
                //   type: "string",
                //   title: "Select an already-downloaded model",
                //   enum: models.data.map(m => m.id),
                //   default: models.data[0]?.id,
                // },
                // }].filter(Boolean),
                // {
                  type: "string",
                  // title: "Type in a model",
                  title: "Model",
                // },
              // ],
            },
          },
          required: ["model"],
        },
      },
      {
        if: {
          properties: { method: { const: "litellm" } },
        },
        then: {
          properties: {
            model: {
              type: "string",
              title: "Model",
              default: "gpt-3.5-turbo",
            },
            api_key: {
              type: "string",
              title: "API Key",
            },
            api_base: {
              type: "string",
              title: "API Base",
            },
            environment_variables: {
              type: "object",
              title: "Environment variables",
              additionalProperties: {
                type: "string",
              },
            },
          },
          required: ["model"],
        },
      },
    ],
  };

  console.log(models)

  const uiSchema = {
    method: {
      "ui:widget": "radio",
    },
    model: {
      // "ui:autofocus": true,
      // "ui:emptyValue": "",
      // "ui:placeholder": "ui:emptyValue causes this field to always be valid despite being required",
      // "ui:autocomplete": "family-name",
      "ui:enableMarkdownInDescription": true,
      // "ui:description": "E.g. `ollama/llama2`. Make sure your model is a valid <a className=\"link\" href=\"https://litellm.vercel.app/docs/#litellm-python-sdk\">LiteLLM model</a>."
      "ui:description": settings.method === "litellm" ?
        "E.g. `ollama/llama2`. Make sure your model is a valid <a className='link' href='https://litellm.vercel.app/docs/#litellm-python-sdk'>LiteLLM model</a>." :
        `The following models were previously downloaded and can be used immediately:\n\n ${models?.data.map(m => `• ${m.id}`).join("\n\n")}`,
    },
  };

  const getSettings = async () => {
    const response = await fetch(`${apiBaseUrl}/v1/settings`);
    const data = await response.json();
    console.log("Fetched settings:", data);
    setSettings(data);
  }

  const saveSettings = async (formData: any) => {
    console.log("Saving settings...", formData);

    await fetch(`${apiBaseUrl}/v1/settings`, {
      method: "PUT",
      body: JSON.stringify(formData),
      headers: {
        "Content-Type": "application/json",
      },
    });

    await getSettings();
  };

  const onSubmit = async (args: { formData: any }) => {
    const { formData } = args
    console.log(schema, formData)

    // TODO: This is a hack, find a better way.
    // Ensure api_key, api_base, model are sent with empty strings if they are not present
    const formDataWithDefaults = formData?.method === 'litellm' ? { ...{
        model: undefined,
        api_key: undefined,
        api_base: undefined,
      }, ...formData } : formData;

    try {
      await saveSettings(formDataWithDefaults);
      console.log("Settings saved successfully!");
    } catch (error) {
      console.error("Error saving settings:", error);
    }
  };

  useEffect(() => {
    (async () => {
      await getSettings();
    })();
  }, []);

  useEffect(() => {
    (async () => {
      if (settings.method === "litellm") {
        const response = await fetch(`${apiBaseUrl}/v1/models`);
        const { data } = await response.json();
        setModels({ data: data?.filter((model: any) => model.id.endsWith(".gguf"))})
      }
    })();
  }, [settings.method]);

  const deepMerge = (target, source) => {
    for (const key in source) {
      if (source[key] && typeof source[key] === 'object') {
        if (!target[key] || typeof target[key] !== 'object') {
          target[key] = {};
        }
        deepMerge(target[key], source[key]);
      } else {
        target[key] = source[key];
      }
    }
    return target;
  };

  const applyPreset = (preset) => {
    setSettings(prevSettings =>
      deepMerge({...prevSettings}, preset.settings)
    );
  }

  const renderPreset = (preset) => {
    return (
      <div key={preset.label} className="preset-button inline-block mr-2">
        <button
          className="btn btn-accent relative"
          onClick={() => applyPreset(preset)}
        >
          {preset.label}
          {preset.docsLink && (
            <a
              href={preset.docsLink}
              target="_blank"
              rel="noopener noreferrer"
              className="link text-xs rounded-br-lg absolute bottom-0 right-0 px-1 rounded-tl-sm bg-neutral text-neutral-content"
              onClick={(e) => e.stopPropagation()}
            >
              Docs
            </a>
          )}
        </button>
      </div>
    );
  }

  const presets = [
    {
      label: 'Local Mistral 7B',
      docsLink: 'https://huggingface.co/TheBloke/Mistral-7B-Instruct-v0.2-GGUF',
      settings: {
        method: 'llama.cpp',
        model: 'TheBloke/Mistral-7B-Instruct-v0.2-GGUF/mistral-7b-instruct-v0.2.Q4_K_M.gguf',
        api_key: '',
        api_base: '',
      }
    },
    {
      label: 'Local Mixtral 8x7B',
      docsLink: 'https://huggingface.co/TheBloke/Mixtral-8x7B-Instruct-v0.1-GGUF',
      settings: {
        method: 'llama.cpp',
        model: 'TheBloke/Mixtral-8x7B-Instruct-v0.1-GGUF/mixtral-8x7b-instruct-v0.1.Q4_K_M.gguf',
        api_key: '',
        api_base: '',
      }
    },
    {
      label: 'Ollama',
      docsLink: 'https://litellm.vercel.app/docs/providers/ollama',
      settings: {
        method: 'litellm',
        model: 'ollama_chat/mistral',
        api_key: '',
        api_base: '',
      }
    },
    {
      label: 'OpenAI-Compatible',
      docsLink: 'https://litellm.vercel.app/docs/providers/openai_compatible',
      settings: {
        method: 'litellm',
        model: 'openai/mistral',
        api_key: 'sk-1234',
        api_base: 'http://0.0.0.0:4000',
      }
    },
    {
      label: 'OpenRouter',
      docsLink: 'https://litellm.vercel.app/docs/providers/openrouter',
      settings: {
        method: 'litellm',
        model: 'openrouter/google/palm-2-chat-bison',
        api_key: '<your-openrouter-api-key>',
        api_base: '',
        environment_variables: {
          OPENROUTER_API_KEY: '<your-openrouter-api-key>',
          OR_SITE_URL: '',
          OR_APP_NAME: '',
        },
      }
    },
    {
      label: 'OpenAI',
      docsLink: 'https://litellm.vercel.app/docs/providers/openai',
      settings: {
        method: 'litellm',
        model: 'gpt-3.5-turbo',
        api_key: '<your-openai-api-key>',
        api_base: '',
        environment_variables: {
          OPENAI_API_KEY: '<your-openai-api-key>',
        },
      }
    },
    // {
    //   label: 'Custom OpenAI Proxy',
    //   docsLink: 'https://litellm.vercel.app/docs/providers/custom_openai_proxy',
    //   settings: {
    //     method: 'litellm',
    //     model: 'command-nightly',
    //     api_key: 'anything',
    //     api_base: 'https://openai-proxy.berriai.repl.co',
    //     environment_variables: {
    //       OPENAI_API_KEY: 'anything',
    //     },
    //     custom_llm_provider: 'openai',  # Need to think about how to support this
    //   }
    // },
  ];

  return (
    <>
      <h2 className="text-xl font-bold mb-4">LLM Presets</h2>

      <p>Customize your LLM provider using one of the presets below, or manually configure <a className="link" href="https://huggingface.co/models?pipeline_tag=text-generation&sort=trending&search=gguf" target="_blank">any llama.cpp</a> or <a className="link" href="https://litellm.vercel.app/docs/providers" target="_blank">LiteLLM-supported model.</a></p>

      <div className="my-3 flex gap-2 flex-wrap">
        {presets.map(renderPreset)}
      </div>

      <h2 className="text-xl font-bold mb-4">Your Settings</h2>

      <TailwindForm
        schema={schema}
        uiSchema={uiSchema}
        onSubmit={onSubmit}
        onChange={({formData}) => setSettings(formData)}
        validator={validator}
        formData={settings}
      >
        <div>
          <button type="submit" className="btn btn-lg btn-block btn-primary mt-4 w-full">
            Save Settings
          </button>
        </div>
      </TailwindForm>
    </>
  );
};

export default Settings;
