import PlaygroundChat from "./PlaygroundChat";
import PlaygroundQuery from "./PlaygroundQuery";

const Playground = () => {
  return (
    <>
      <PlaygroundChat />
      <div className="h-4" />
      <PlaygroundQuery />
    </>
  );
}

Playground.displayName = 'Playground';

export default Playground;
