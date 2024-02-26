import React, { useEffect, useState } from 'react';
import Tooltip from '../Tooltip';
import {apiBaseUrl} from "@/app/config";
import useAsyncTask from "@/app/hooks/useAsyncTask";
import TaskToast from "@/app/components/TaskToast";


const fetchDocuments = async (topic: string, limit?: number, minScore?: number, includeSummary?: boolean) => {
  const params = new URLSearchParams({ topic, ...(limit && { limit: limit.toString() }), ...(minScore && { min_score: minScore.toString() }), ...(includeSummary !== undefined && { include_summary: includeSummary.toString() }) });
  const url = `${apiBaseUrl}/v1/index_documents/summary?${params.toString()}`;

  try {
    const response = await fetch(url);
    return response.json();
  } catch (error) {
    console.error('Error fetching documents:', error);
  }
};

const PlaygroundQuery = () => {
  const { isTaskRunning, taskMessage, executeTask } = useAsyncTask();
  const [query, setQuery] = useState('');
  const [documents, setDocuments] = useState([]);
  const [summary, setSummary] = useState('');
  const [score, setScore] = useState(0);
  const [limit, setLimit] = useState<number | undefined>();
  const [minScore, setMinScore] = useState<number | undefined>();
  const [includeSummary, setIncludeSummary] = useState(true);

  const handleInputChange = (setter: React.Dispatch<React.SetStateAction<any>>) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.type === 'number' ? Number(e.target.value) || undefined : e.target.value;
    setter(value);
  };

  const handleQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
  };

  const handleQuery = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    executeTask(async () => {
      setScore(0);
      setDocuments([]);
      setSummary('');
      const results = await fetchDocuments(query, limit, minScore, includeSummary);
      setScore(results.score);
      setDocuments(results.documents);
      setSummary(results.summary);
      console.log('Searching with:', query, limit, minScore, includeSummary);
    },  {
      start: 'Searching...',
      success: 'Search complete',
      error: 'Search failed',
    });
  };

  const renderDocument = (doc: any, i: number) => {
    return (
      <div key={i} className="card prose prose-sm bordered mb-4 bg-base-200 w-full max-w-full">
        <div className="card-body">
          {/*<h2 className="card-title">Document {doc.id}</h2>*/}
          <h2 className="card-title m-0">Embedding document {i}</h2>
          <pre className="m-0">{doc.text}</pre>
          <ul className="m-0">
            {/*<li>Score: {doc.score}</li>*/}
            {/* only 2 decimal */}
            <li>Overall score: {doc.score.toFixed(2)}</li>
            <li>Relevance score: {doc.relevance.toFixed(2)}</li>
            <li>Recency score: {doc.recency.toFixed(2)}</li>
            <li>Source: {doc.source}</li>
            <li>Timestamp: {new Date(doc.timestamp).toLocaleString()}</li>
          </ul>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* TODO: this is necessary until useAsyncTask is refactored to use global state */}
      {taskMessage && <TaskToast isTaskRunning={isTaskRunning} taskMessage={taskMessage} />}
      <h2 className="text-xl font-bold mb-4">Search</h2>

      <div className="flex flex-col lg:flex-row gap-4">
        <div className="lg:w-1/2">
          <form className="form max-w-full" onSubmit={handleQuery}>
            <div className="form-control mb-2">
              {/*<label className="label">*/}
                {/*<span className="label-text">Limit</span>*/}
              {/*</label>*/}
              <input
                type="number"
                className="input input-sm input-bordered"
                placeholder="Number of documents (optional)"
                value={limit === undefined ? '' : limit}
                onChange={(e) => setLimit(Number(e.target.value) || undefined)}
                min="1"
              />
            </div>

            <div className="form-control">
              {/*<label className="label">*/}
              {/*  <span className="label-text">Minimum Score</span>*/}
              {/*</label>*/}
              <input
                type="number"
                className="input input-sm input-bordered"
                placeholder="Minimum score (optional)"
                value={minScore === undefined ? '' : minScore}
                onChange={(e) => setMinScore(Number(e.target.value) || undefined)}
                min="0"
                max="1"
                step="0.1"
              />
            </div>

            <div className="form-control">
              <label className="label cursor-pointer flex gap-2 items-center">
                <span className="label-text">Include Summary</span>
                <input
                  type="checkbox"
                  className="toggle toggle-sm toggle-accent"
                  checked={includeSummary}
                  onChange={(e) => setIncludeSummary(e.target.checked)}
                />
              </label>
            </div>

            <label className="input input-bordered flex items-center gap-2 mb-4">
              <input
                disabled={isTaskRunning}
                type="text"
                className="grow bg-base-100"
                placeholder="Search for anything..."
                value={query}
                onChange={handleQueryChange}
              />
              <button type="submit" className="button">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor"
                     className="w-4 h-4 opacity-70">
                  <path fillRule="evenodd"
                        d="M9.965 11.026a5 5 0 1 1 1.06-1.06l2.755 2.754a.75.75 0 1 1-1.06 1.06l-2.755-2.754ZM10.5 7a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0Z"
                        clipRule="evenodd"/>
                </svg>
              </button>
            </label>
          </form>
        </div>
        {!!score && <div className="lg:w-1/2 mb-4">
          {/*<Tooltip tip="Search for anything" />*/}
            <p>{summary}</p>
            <p className="mt-4">Result Score: {score.toFixed(2)}</p>
        </div>}
      </div>
      {!!score && <div>
        {documents.map(renderDocument)}
      </div>}
    </div>
  );
};

PlaygroundQuery.displayName = 'PlaygroundQuery';

export default PlaygroundQuery;
