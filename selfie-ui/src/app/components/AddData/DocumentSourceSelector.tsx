import { ChangeEvent, useEffect, useState } from 'react';
import { apiBaseUrl } from "@/app/config";

type DocumentSourceSelectorProps = {
  onSelect: (selectedId: string) => void;
};

type OptionType = {
  value: string;
  label: string;
};

const DocumentSourceSelector = ({ onSelect }: DocumentSourceSelectorProps) => {
  const [sources, setSources] = useState<OptionType[]>([]);

  useEffect(() => {
    fetch(`${apiBaseUrl}/v1/connectors`)
      .then((response) => response.json())
      .then((data) => {
        const options: OptionType[] = data.connectors.map(
          (connector: { id: string; name: string; }) => ({
          value: connector.id,
          label: connector.name
        }));
        setSources(options);
      })
      .catch((error) => console.error('Error fetching document sources:', error));
  }, []);

  // const handleChange = (selectedOption: SingleValue<OptionType>, actionMeta: ActionMeta<OptionType>) => {
  const handleChange = (e: ChangeEvent<HTMLSelectElement>) => {
    const selectedOption = e.target;
    // console.log(e)
    if (selectedOption) {
      onSelect(selectedOption.value);
    }
  };

  return (
    <select className="select select-bordered w-full max-w-sm" onChange={handleChange} defaultValue={''}>
      <option disabled value="">Select a data source...</option>
      {sources.map((source) => (
        <option key={source.value} value={source.value}>
          {source.label}
        </option>
      ))}
    </select>
  );
};

export default DocumentSourceSelector;
