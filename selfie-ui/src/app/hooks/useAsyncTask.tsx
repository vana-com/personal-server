import { useState, useCallback } from 'react';

type AsyncTaskFn = () => Promise<void>;
type UseAsyncTaskHook = () => {
  isTaskRunning: boolean;
  taskMessage: string;
  executeTask: (asyncTask: AsyncTaskFn, messages: { start: string; success: string; error: string }) => any;
};

const useAsyncTask: UseAsyncTaskHook = () => {
  const [isTaskRunning, setTaskRunning] = useState<boolean>(false);
  const [taskMessage, setTaskMessage] = useState<string>('');

  const executeTask = useCallback((asyncTask: AsyncTaskFn, messages: { start: string; success: string; error: string }) => {
    console.info('Executing task...');
    setTaskRunning(true);
    setTaskMessage(messages.start);
    asyncTask()
      .then(() => {
        console.info('Task completed successfully');
        setTaskMessage(messages.success);
      })
      .catch((error) => {
        console.error('Task failed:', error);
        setTaskMessage(messages.error);
      })
      .finally(() => {
        setTaskRunning(false);
        setTimeout(() => setTaskMessage(''), 5000);
      });
  }, []);

  return { isTaskRunning, taskMessage, executeTask };
};

export default useAsyncTask;
