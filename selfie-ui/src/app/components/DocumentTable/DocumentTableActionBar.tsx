import React from 'react';

interface IndexDocumentsFormProps {
  onIndexDocuments: () => void | Promise<void>;
  onUnindexDocuments: () => void | Promise<void>;
  hasSelectedDocuments: boolean;
  disabled?: boolean;
}

export const DocumentTableActionBar: React.FC<IndexDocumentsFormProps> = ({
                                                                        onIndexDocuments,
                                                                        onUnindexDocuments,
                                                                        hasSelectedDocuments,
                                                                        disabled = false,
                                                                      }) => {
  const handleSubmit = async (event: React.FormEvent, isIndex: boolean) => {
    event.preventDefault();
    if (isIndex) {
      await onIndexDocuments();
    } else {
      await onUnindexDocuments();
    }
  };

  return (
    <form onSubmit={() => {}} className="flex items-center space-x-4">
      <button
        type="button"
        className="btn btn-sm mr-2"
        disabled={disabled || !hasSelectedDocuments}
        onClick={(event) => handleSubmit(event, true)}
      >
        Index Selected
      </button>
      <button
        type="button"
        className="btn btn-sm btn-error"
        disabled={disabled || !hasSelectedDocuments}
        onClick={(event) => handleSubmit(event, false)}
      >
        Unindex Selected
      </button>
    </form>
  );
};
