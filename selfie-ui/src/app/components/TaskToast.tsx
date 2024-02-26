import React from 'react';

export const TaskToast = ({ isTaskRunning, taskMessage }: { isTaskRunning: boolean; taskMessage: string }) => (
  <div className="toast toast-top toast-end z-10">
      <div className={`alert alert-${isTaskRunning ? 'info' : 'success'}`}>
          <span>{taskMessage}</span>
      </div>
  </div>
);

TaskToast.displayName = 'TaskToast';

export default TaskToast;
