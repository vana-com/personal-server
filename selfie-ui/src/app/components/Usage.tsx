import CodeSnippet from "@/app/components/CodeSnippet";
import { apiBaseUrl } from "@/app/config";

const jsExample = (<CodeSnippet snippet={`import OpenAI from 'openai';

const openai = new OpenAI({
  baseURL: 'http://localhost:8181/v1',
  apiKey: ''
});

const name = 'Alice';
const chatCompletion = await openai.chat.completions.create({
  // model: 'TheBloke/Mistral-7B-Instruct-v0.2-GGUF/mistral-7b-instruct-v0.2.Q5_K_M.gguf', // Optionally, customize the model used
  messages: [
    { role: 'system', content: \`Write $\{name\}'s next reply in a fictional chat with $\{name\} and their friends.\` },
    { role: 'user', content: 'Favorite ice cream?' },
  ]
} as any);

console.log(chatCompletion.choices[0].message.content);
// "Alice enjoys Bahn Mi and Vietnamese coffee."
`} />);

const Usage = () => (
  <>
    <h1 className="text-4xl font-bold mb-4">Usage</h1>
    <section className="mb-8">
      <p className="mb-4">To get started, add a directory containing chat files, then index one or more documents to
        add them to the knowledge bank.</p>
      <p>
        Once indexed, data will be used automatically in chat completions.
        {jsExample}
      </p>
      <p>
        Explore and test the full set of API features for indexed data on <a className="link" href={`${apiBaseUrl}/docs`}>the documentation page</a>.
        For a quick start, try the <a className="link" href={`${apiBaseUrl}/docs#/default/get_index_documents_summary_v1_index_documents_summary_get`}
      >Summary API</a>.
      </p>
    </section>
  </>
)

Usage.displayName = 'Usage';

export default Usage;
