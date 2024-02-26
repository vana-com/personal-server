// TODO: define this type
export type Document = any
// export interface Document {
//   id: string
//   metadata: {
//     [key: string]: any
//   }
//   is_indexed: boolean
//   num_index_documents?: number
// }

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
