import React, { useEffect } from 'react';
import Prism from 'prismjs';
import 'prismjs/themes/prism-okaidia.css'; // Or any other theme you prefer

const CodeSnippet = ({snippet}: {snippet: string}) => {
  useEffect(() => {
    // Highlight syntax whenever the component mounts or updates
    Prism.highlightAll();
  }, []);

  return (
    <div className="overflow-x-auto">
    <pre><code className="language-javascript">
      {snippet}
  </code></pre>
    </div>
  );
};

export default CodeSnippet;