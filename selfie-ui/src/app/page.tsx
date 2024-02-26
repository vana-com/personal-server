"use client";

import React, {useEffect, useState} from 'react';
import { apiBaseUrl } from "@/app/config";
import { ThemeChanger } from "@/app/components/ThemeChanger";
import { AddData } from "@/app/components/AddData";
import useAsyncTask from "@/app/hooks/useAsyncTask";
import TaskToast from "@/app/components/TaskToast";
import DataManager from "@/app/components/DataManager";
import { Playground } from "@/app/components/Playground";

const pages = [
  { component: Playground, id: 'playground' },
  { component: AddData, id: 'addData' },
  //{ component: DataManager, id: 'dataManager' },
];

const App = () => {
  const [activeDrawerItem, setActiveDrawerItem] = useState('');
  const { isTaskRunning, taskMessage } = useAsyncTask();

  useEffect(() => {
    const setDrawerItemFromHash = () => {
      setActiveDrawerItem(window.location.hash.slice(1) || 'playground');
    };

    setDrawerItemFromHash();
    window.addEventListener('hashchange', setDrawerItemFromHash);
    return () => window.removeEventListener('hashchange', setDrawerItemFromHash);
  }, []);

  useEffect(() => {
    if (activeDrawerItem) {
      window.location.hash = activeDrawerItem;
    }
  }, [activeDrawerItem]);

  const renderComponentName = (component: any) =>
    (component.displayName || component.name || 'Unknown').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (s: string) => s.toUpperCase())

  return (
    <div className="bg-base-100 drawer lg:drawer-open text-base-content">
      <input id="my-drawer" type="checkbox" className="drawer-toggle"/>
      <div className="drawer-content flex flex-col">

        {/* Navbar for mobile */}
        <div className="w-full navbar bg-base-300 lg:hidden">
          <label htmlFor="my-drawer" className="btn btn-square btn-ghost">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
                 className="inline-block w-6 h-6 stroke-current">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16"></path>
            </svg>
          </label>
          <div className="flex-1 px-2 mx-2 text-2xl">Selfie</div>
        </div>

        {/* Page content here */}

        <div className="px-6">

          {/* TODO: useAsyncTask will not convey messages for tasks in descendant components until it is refactored to use global state */}
          {taskMessage && <TaskToast isTaskRunning={isTaskRunning} taskMessage={taskMessage} />}

          {pages.map(({ component: Component, id }) => (
            <div key={id} className={activeDrawerItem === id ? '' : 'hidden'}>

              <div className="container mx-auto py-4">
                <h1 className="text-2xl font-bold mb-4">{renderComponentName(Component)}</h1>
                <Component />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="drawer-side">
        {/* Sidebar content here */}
        <label htmlFor="my-drawer" className="drawer-overlay"></label>
        <aside className="bg-base-200 min-h-screen">
          <h1 className="lg:flex hidden px-4 pt-4 text-2xl">Selfie</h1>
          <ul className="menu p-4 overflow-y-auto w-60">
            {/* Sidebar content here */}
            { pages.map(({ id, component: Component }) => (
              <li key={id}>
                <a onClick={() => setActiveDrawerItem(id)} className={activeDrawerItem === id ? 'active' : ''}>
                  {renderComponentName(Component)}
                </a>
              </li>
            ))}
            <li></li>
            <li>
              <a className="link link-hover" href={`${apiBaseUrl}/docs`} target="_blank">
                API Docs
              </a>
            </li>
            <li>
              <a className="link link-hover" href="https://github.com/vana-com/selfie" target="_blank"
                 rel="noopener noreferrer">
                {/*<FaGithub className="w-6 h-6 mr-4"/> GitHub*/}
                GitHub
              </a>
            </li>
            <li>
              <ThemeChanger />
            </li>
          </ul>
        </aside>
      </div>
    </div>
  );
};

App.displayName = 'App';

export default App;
