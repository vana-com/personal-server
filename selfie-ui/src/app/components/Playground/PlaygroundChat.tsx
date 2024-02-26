import React, { useEffect, useState } from 'react';
import { Chat } from "../Chat";
import Tooltip from '../Tooltip';

const defaultAssistantName = 'Wilson';
const defaultAssistantBio = 'Wilson was born in Nantucket. He loves fried chicken.';

const PlaygroundChat = ({ disabled = false, hasIndexedDocuments = true }: { disabled?: boolean, hasIndexedDocuments?: boolean }) => {
  const [shouldClear, setShouldClear] = useState(false);
  const [disableAugmentation, setDisableAugmentation] = useState(false);

  const [name, setName] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('assistantName') || defaultAssistantName;
    }
    return defaultAssistantName;
  });

  const [bio, setBio] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('assistantBio') || defaultAssistantBio;
    }
    return defaultAssistantBio;
  });

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('assistantName', name);
    }
  }, [name]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('assistantBio', bio);
    }
  }, [bio]);

  return (<>
    <p className="mb-4">
      Explore what Selfie can do by chatting with an AI that uses your data or by searching your data directly. If you haven't already, add some data in the "Add Data" tab.
    </p>
    <h2 className="text-xl font-bold mb-4">Chat</h2>
    <div className="flex flex-col lg:flex-row gap-4 w-full">
      <div className="w-full lg:w-1/2">
        <div className="form-control w-100">
          <label className="label cursor-pointer flex justify-start">
            <span className="label-text">Data Augmentation Enabled</span>

            <input
              type="checkbox"
              className="toggle mx-2"
              title={!hasIndexedDocuments ? 'Add and index some documents to enable augmentation.' : ''}
              disabled={disabled}
              checked={hasIndexedDocuments && !disableAugmentation}
              onChange={() => setDisableAugmentation(!disableAugmentation)}
            />
            {!hasIndexedDocuments && <Tooltip tip="Add and index some documents to enable augmentation."/>}
          </label>
        </div>
        <button className="btn btn-sm mb-2" onClick={(e) => {
          e.preventDefault();
          setShouldClear(prev => !prev)
        }}>Clear Messages
        </button>
        <Chat assistantName={name}
              assistantBio={bio}
              disableAugmentation={!hasIndexedDocuments || disableAugmentation}
              shouldClear={shouldClear}
              instruction={hasIndexedDocuments ? '' : 'You have no indexed documents. You can still use the playground, but your data will not be used to generate responses. Add and index documents to enable augmentation.'}
        />
      </div>
      <div className="w-full lg:w-1/2 flex flex-col">
        <div className="form-control">
          <label className="label">
              <span className="label-text">Assistant Name
                <Tooltip tip="In a future version, name and bio will be configured and applied automatically."/>
              </span>
          </label>

          <input
            type="text"
            placeholder={`Enter Assistant Name, e.g. ${defaultAssistantName}`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="input input-sm input-bordered w-full max-w-xs mr-2"/>
        </div>
        <div className="form-control h-full">
          <label className="label">
            <span className="label-text">Assistant Bio</span>
          </label>
          <textarea className="textarea textarea-md h-full textarea-bordered"
                    placeholder={`Enter Assistant Bio, e.g. ${defaultAssistantBio}`}
                    value={bio}
                    onChange={(e) => setBio(e.target.value)}
          ></textarea>
        </div>
      </div>
    </div>
  </>)
};

PlaygroundChat.displayName = 'PlaygroundChat';

export default PlaygroundChat;
