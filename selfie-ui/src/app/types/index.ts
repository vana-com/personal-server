export interface Document {
  id: string
  metadata: {
    [key: string]: any
  }
  is_indexed: boolean
}

export interface Documents {
  [sourceId: string]: Document[]
}

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
