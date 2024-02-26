import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';

export const Markdown = ({ content }: { content: string }) => {
  return (
    <ReactMarkdown
      className="prose prose-sm"
      rehypePlugins={[rehypeRaw, rehypeSanitize]}
      // rehypePlugins={[rehypeHighlight]}
    >
      {content}
    </ReactMarkdown>
  );
};