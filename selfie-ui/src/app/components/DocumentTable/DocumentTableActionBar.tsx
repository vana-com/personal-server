import React from 'react';

import { Document, DocumentStats } from "@/app/types";

interface IndexDocumentsFormProps {
  onIndexDocuments: () => void | Promise<void>;
  onUnindexDocuments: () => void | Promise<void>;
  indexableDocuments: Document[];
  unindexableDocuments: Document[];
  hasSelectedDocuments: boolean;
  disabled?: boolean;
  stats?: DocumentStats;
}

export const DocumentTableActionBar: React.FC<IndexDocumentsFormProps> = ({
                                                                        onIndexDocuments,
                                                                        onUnindexDocuments,
                                                                        indexableDocuments,
                                                                        unindexableDocuments,
                                                                        hasSelectedDocuments,
                                                                        disabled = false,
                                                                        stats,
                                                                      }) => {
  const handleSubmit = async (event: React.FormEvent, isIndex: boolean) => {
    event.preventDefault();
    await (isIndex ? onIndexDocuments() : onUnindexDocuments());
  };

  return (
    <div className="flex justify-between">
      <form onSubmit={() => {
      }} className="flex items-center space-x-4">
        <button
          type="button"
          className="btn btn-sm mr-2"
          disabled={disabled || !hasSelectedDocuments || indexableDocuments.length === 0}
          onClick={(event) => handleSubmit(event, true)}
        >
          Index {indexableDocuments.length}
        </button>
        <button
          type="button"
          className="btn btn-sm btn-error btn-outline"
          disabled={disabled || !hasSelectedDocuments || unindexableDocuments.length === 0}
          onClick={(event) => handleSubmit(event, false)}
        >
          Unindex {unindexableDocuments.length}
        </button>
      </form>

      {stats && Object.keys(stats).length && <span className="my-4">
          Total: {stats.totalDocuments} | Indexed: {stats.numDocumentsIndexed} | Indexed Chunks: {stats.numEmbeddingIndexDocuments}
      </span>}
    </div>
  );
};
