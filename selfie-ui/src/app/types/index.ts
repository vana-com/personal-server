// TODO: define this type

export interface Document {
  id: string;
  created_at: string;
  updated_at: string;
  content_type: string;
  name: string;
  size: number;
  connector_name: string;
}

export interface Documents {
  [sourceId: string]: Document[]
}

// TODO: define this type
export type DocumentConnection = any

export interface DataSource {
  id: string;
  name: string;
  loader_module: string;
  config: {
    constructor_args: any[];
    constructor_kwargs: {
      input_dir: string;
      recursive: boolean;
    };
    load_data_args: any[];
    load_data_kwargs: any;
  };
}

export interface DocumentStats {
  totalDocuments: number;
  numDocumentsIndexed: number;
  numEmbeddingIndexDocuments: number;
}
