import React, { useState } from "react";
import { apiBaseUrl } from "@/app/config";
import useAsyncTask from "@/app/hooks/useAsyncTask";
import TaskToast from "@/app/components/TaskToast";

const fetchDocuments = async (
  query: string,
  limit?: number,
  minScore?: number,
  includeSummary?: boolean,
  relevanceWeight?: number,
  recencyWeight?: number,
  importanceWeight?: number
) => {
  const params = new URLSearchParams({
    query,
    ...(limit && { limit: limit.toString() }),
    ...(minScore && { min_score: minScore.toString() }),
    ...(includeSummary !== undefined && { include_summary: includeSummary.toString() }),
    ...(relevanceWeight && { relevance_weight: relevanceWeight.toString() }),
    ...(recencyWeight && { recency_weight: recencyWeight.toString() }),
    ...(importanceWeight && { importance_weight: importanceWeight.toString() }),
  });
  const url = `${apiBaseUrl}/v1/documents/search?${params.toString()}`;

  try {
    const response = await fetch(url);
    return response.json();
  } catch (error) {
    console.error("Error fetching documents:", error);
    throw error;
  }
};

const PlaygroundQuery = () => {
  const { isTaskRunning, taskMessage, executeTask } = useAsyncTask();
  const [query, setQuery] = useState("");
  const [documents, setDocuments] = useState([]);
  const [summary, setSummary] = useState("");
  const [isSummaryLoading, setSummaryLoading] = useState(false);
  const [averageScore, setAverageScore] = useState(0);
  const [totalResults, setTotalResults] = useState(0);
  const [limit, setLimit] = useState<number | undefined>();
  const [minScore, setMinScore] = useState<number | undefined>();
  const [includeSummary, setIncludeSummary] = useState(true);
  const [relevanceWeight, setRelevanceWeight] = useState<number | undefined>();
  const [recencyWeight, setRecencyWeight] = useState<number | undefined>();
  const [importanceWeight, setImportanceWeight] = useState<number | undefined>();

  const handleInputChange = (setter: React.Dispatch<React.SetStateAction<any>>) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.type === "number" ? Number(e.target.value) || undefined : e.target.value;
    setter(value);
  };

  const handleQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
  };

  const handleQuery = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    executeTask(async () => {
      setAverageScore(0);
      setTotalResults(0);
      setDocuments([]);
      setSummary("");
      setSummaryLoading(true);
      const results = await fetchDocuments(
        query,
        limit,
        minScore,
        includeSummary,
        relevanceWeight,
        recencyWeight,
        importanceWeight
      );
      setAverageScore(results.average_score);
      setTotalResults(results.total_results);
      setDocuments(results.documents);
      setSummary(results.summary);
      setSummaryLoading(false);
      console.log("Searching with:", query, limit, minScore, includeSummary, relevanceWeight, recencyWeight, importanceWeight);
    }, {
      start: "Searching...",
      success: "Search complete",
      error: "Search failed",
    });
  };

  const renderDocument = (doc: any, i: number) => {
    return (
      <div key={i} className="card prose prose-sm bordered mb-4 bg-base-200 w-full max-w-full">
        <div className="card-body">
          <h2 className="card-title m-0">Embedding Document {doc.id}</h2>
          <pre className="m-0">{doc.text}</pre>
          <ul className="m-0">
            <li>Overall score: {doc.score.toFixed(2)}</li>
            <li>Relevance score: {doc.relevance.toFixed(2)}</li>
            <li>Recency score: {doc.recency.toFixed(2)}</li>
            <li>Source: {doc.source}</li>
            <li>Timestamp: {new Date(doc.timestamp).toLocaleString()}</li>
          </ul>
        </div>
      </div>
    );
  };

  return (
    <div>
      {/* TODO: this is necessary until useAsyncTask is refactored to use global state */}
      {taskMessage && <TaskToast isTaskRunning={isTaskRunning} taskMessage={taskMessage} />}
      <h2 className="text-xl font-bold mb-4">Search</h2>

      <div className="flex flex-col lg:flex-row gap-4">
        <div className="lg:w-1/2">
          <form className="form max-w-full" onSubmit={handleQuery}>
            <label className="input input-bordered flex items-center gap-2">
              <input
                disabled={isTaskRunning}
                type="text"
                className="grow bg-base-100"
                placeholder="E.g. favorite snacks"
                value={query}
                onChange={handleQueryChange}
              />
              {/*<button type="submit">*/}
              {/*  {isSummaryLoading ? <LoadingIcon/> : <SearchIcon/>}*/}
              {/*</button>*/}
            </label>

            <div className="form-control">
              <label className="label cursor-pointer flex gap-2 items-center">
                <span className="label-text">Include Summary</span>
                <input
                  type="checkbox"
                  className="toggle toggle-sm toggle-primary"
                  checked={includeSummary}
                  onChange={(e) => setIncludeSummary(e.target.checked)}
                />
              </label>
            </div>


            <div className="collapse collapse-arrow collapse-xs bg-base-200 mb-4">
              <input type="checkbox"/>
              <div className="collapse-title">
                Advanced options
              </div>
              <div className="collapse-content flex flex-col gap-2">
                <div className="form-control">
                  {/*<label className="label">*/}
                  {/*<span className="label-text">Limit</span>*/}
                  {/*</label>*/}
                  <input
                    type="number"
                    className="input input-sm input-bordered"
                    placeholder="Maximum number of documents"
                    value={limit === undefined ? "" : limit}
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
                    placeholder="Minimum score (0.0 to 1.0)"
                    value={minScore === undefined ? "" : minScore}
                    onChange={(e) => setMinScore(Number(e.target.value) || undefined)}
                    min="0"
                    max="1"
                    step="0.01"
                  />
                </div>

                <div className="form-control">
                  {/*<label className="label">*/}
                  {/*  <span className="label-text">Relevance Weight</span>*/}
                  {/*</label>*/}
                  <input
                    type="number"
                    className="input input-sm input-bordered"
                    value={relevanceWeight === undefined ? "" : relevanceWeight}
                    placeholder="Relevance weight (0.0 to 1.0)"
                    onChange={(e) => setRelevanceWeight(e.target.value ? Number(e.target.value) : undefined)}
                    min="0"
                    max="1"
                    step="0.01"
                  />
                </div>

                <div className="form-control">
                  {/*<label className="label">*/}
                  {/*  <span className="label-text">Recency Weight</span>*/}
                  {/*</label>*/}
                  <input
                    type="number"
                    className="input input-sm input-bordered"
                    value={recencyWeight === undefined ? "" : recencyWeight}
                    placeholder="Recency weight (0.0 to 1.0)"
                    onChange={(e) => setRecencyWeight(e.target.value ? Number(e.target.value) : undefined)}
                    min="0"
                    max="1"
                    step="0.01"
                  />
                </div>
              </div>
            </div>

            <button type="submit" className="btn btn-primary btn-block">
              Submit
            </button>
          </form>
        </div>
        {!!summary && (
          <div className="lg:w-1/2 mb-4">
            {/*<Tooltip tip="Search for anything" />*/}
            <p>{summary}</p>
            {documents.length ? (
              <div className="mt-4">
                <p>Total Results: {totalResults}</p>
                <p>Average Score: {averageScore.toFixed(2)}</p>
              </div>
            ) : null}
          </div>
        )}
      </div>
      {documents.length > 0 && <div>{documents.map(renderDocument)}</div>}
    </div>
  );
};

const SearchIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4 opacity-70">
    <path
      fillRule="evenodd"
      d="M9.965 11.026a5 5 0 1 1 1.06-1.06l2.755 2.754a.75.75 0 1 1-1.06 1.06l-2.755-2.754ZM10.5 7a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0Z"
      clipRule="evenodd"
    />
  </svg>
);

const LoadingIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="16px"
    height="16px"
    viewBox="0 0 100 100"
    preserveAspectRatio="xMidYMid"
  >
    <circle
      cx="50"
      cy="50"
      fill="none"
      stroke="currentColor"
      strokeWidth="10"
      r="35"
      strokeDasharray="164.93361431346415 56.97787143782138"
    >
      <animateTransform
        attributeName="transform"
        type="rotate"
        repeatCount="indefinite"
        dur="1s"
        values="0 50 50;360 50 50"
        keyTimes="0;1"
      ></animateTransform>
    </circle>
  </svg>
);

PlaygroundQuery.displayName = "PlaygroundQuery";

export default PlaygroundQuery;
