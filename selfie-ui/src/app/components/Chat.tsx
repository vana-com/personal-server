"use client";

import React, { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { RequestDetails } from "deep-chat/dist/types/interceptors";
import { useTheme } from "next-themes";
import { apiBaseUrl } from "../config";

const DeepChat = dynamic(
  () => import('deep-chat-react').then((mod) => ({ default: mod.DeepChat })),
  { ssr: false }
);

export const Chat = ({
                       assistantName = "Assistant",
                       assistantBio = "",
                       userName = "User",
                       disableAugmentation = false,
                       shouldClear = false, // TODO: figure out how to use this
                       instruction = ''
                     }) => {
  const { theme } = useTheme();

  const [showIntroPanel, setShowIntroPanel] = useState(!!instruction);

  const chatStyle = {
    borderRadius: '10px',
    border: 'unset solid 1px oklch(var(--b2)*0.2)', // The 0.2 is not working, can't match textarea-bordered so using --b2 below instead.
    backgroundColor: 'oklch(var(--b2))',
    // backgroundColor: 'oklch(var(--b1))',
    width: '100%',
    maxWidth: 'inherit',
    display: 'block'
  };

  const chatMessageStyle = {
    default: {
      ai: { bubble: { backgroundColor: 'oklch(var(--b3))', color: 'oklch(var(--bc))' } },
      user: { bubble: { backgroundColor: 'oklch(var(--p))', color: 'oklch(var(--pc))' } },
    },
    // loading: {
    //   bubble: { backgroundColor: 'oklch(var(--b3))', color: 'oklch(var(--bc))' },
    // }
  };

  const chatInputStyle = {
    styles: {
      container: {
        backgroundColor: 'oklch(var(--b3))',
        border: 'unset',
        color: 'oklch(var(--bc))'
      },
    },
    placeholder: { text: "Say anything here...", style: { color: 'oklch(var(--bc))' } } // Use base-200 color for placeholder
  };

  const chatSubmitButtonStyles = {
    submit: {
      container: {
        default: { bottom: '0.7rem' }
      },
      svg: {
        styles: {
          default: {
            filter: "brightness(0) saturate(100%) invert(70%) sepia(52%) saturate(5617%) hue-rotate(185deg) brightness(101%) contrast(101%)"
          }
        }
      }
    }
  };

  const auxiliaryStyle=`::-webkit-scrollbar {
    width: 10px;
    height: 10px;
  }
  ::-webkit-scrollbar-thumb {
    background-color: oklch(var(--n));
    border-radius: 5px;
  }
  ::-webkit-scrollbar-track {
    background-color: unset;
  }`

  useEffect(() => {
    setShowIntroPanel(!!instruction);
  }, [instruction]);

  return <DeepChat
    key={`${assistantName}-${assistantBio}-${userName}-${disableAugmentation}-${showIntroPanel}-${theme}`} // Re-render on theme change
    style={chatStyle}
    messageStyles={chatMessageStyle}
    textInput={chatInputStyle}
    submitButtonStyles={chatSubmitButtonStyles}
    auxiliaryStyle={auxiliaryStyle}
    initialMessages={[
      {"text": "Hello! How are you?", "role": "assistant"},
    ]}
    stream={true}
    request={{
      url: `${apiBaseUrl}/v1/chat/completions`,
      method: 'POST',
      headers: {
        'Authorization': 'bearer ignored',
      },
      additionalBodyProps: {
        disable_augmentation: disableAugmentation,

        /** Uncomment and edit to use a local OpenAI-compatible API, e.g. text-generation-webui on localhost:5000.
         api_base: 'http://localhost:5000/v1',
         // When api_base refers to a local text-generation-webui API, we need to specify the instruction template.
         instruction_template: 'mistral',
         **/

        model: '',
        stop: ['[END]', '[INST]', '[/INST]'],
        stream: true,
        temperature: 0.3,
        frequency_penalty: 0.7,
        presence_penalty: 0.7,
        top_p: 1,
        max_tokens: 350,
      },
    }}
    requestInterceptor={(details: RequestDetails) => {
      details.body.messages = details.body.messages.map((message: {role: string, text: string}) => {
        return { role: message.role, content: message.text };
      });

      const system_prompt = `You are ${assistantName}, chatting with ${userName} in a fictional roleplay in which you are playing yourself. Write 1 reply only. Be proactive, creative, and drive the plot and conversation forward. Write at least 1 sentence, up to 4. Always stay in character and avoid repetition.${ assistantBio ? `\n${assistantBio}` : ''}`

      const message = {
        role: 'system',
        content: system_prompt
      }
      details.body.messages = [message, ...details.body.messages];

      return details;
    }}
    responseInterceptor={(details: any) => ({ text: details.choices?.[0].delta.content })}

  >
    {showIntroPanel && <div
      style={{
        width: '200px',
        backgroundColor: 'oklch(var(--b3))',
        borderRadius: '8px',
        padding: '12px',
        // paddingBottom: '15px',
        display: 'none',
      }}
    >
      <div>
        <div style={{textAlign: 'center', marginBottom: '8px', fontSize: '16px'}}>
          {/*<b>Unused Heading</b>*/}
        </div>
          <div style={{fontSize: '15px', lineHeight: '20px'}}>
            <div style={{ marginBottom: '4px' }}>{instruction}</div>
            <button className="close-button" onClick={() => {setShowIntroPanel(false);}}>Okay</button>
          </div>
      </div>
    </div>}
  </DeepChat>
}
