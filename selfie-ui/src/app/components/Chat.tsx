"use client";

import React, { useState } from "react";
import dynamic from "next/dynamic";
import { RequestDetails } from "deep-chat/dist/types/interceptors";


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
  const [showIntroPanel, setShowIntroPanel] = useState(!!instruction);

  return <DeepChat
    // clearMessages={(shouldClear) => {}}
    key={`${assistantName}-${assistantBio}-${userName}-${disableAugmentation}-${showIntroPanel}`} // Force re-render when props are changed
    htmlClassUtilities={{
      'close-button': {
        events: {
          click: () => {
            setShowIntroPanel(false);
          },
        },
        styles: {
          default: {
            cursor: 'pointer',
            textAlign: 'center',
            backgroundColor: '#555',
            color: 'white',
            padding: '4px 8px',
            border: '1px solid #666',
            borderRadius: '10px',
            fontSize: '16px',
            marginBottom: '10px',
          },
        },
      },
      'custom-button-text': { styles: { default: { pointerEvents: 'none' } } },
    }}
    style={{
      borderRadius: '10px',
      border: 'unset',
      backgroundColor: '#292929',
      width: '100%',
      maxWidth: 'inherit',
      display: 'block'
    }}
    messageStyles={{
      "default": {
        "ai": {"bubble": {"backgroundColor": "#545454", "color": "white"}}
      },
      "loading": {
        "bubble": {"backgroundColor": "#545454", "color": "white"}
      }
    }}
    textInput={{
      "styles": {
        "container": {
          "backgroundColor": "#666666",
          "border": "unset",
          "color": "#e8e8e8"
        }
      },
      "placeholder": {"text": "Say anything here...", "style": {"color": "#bcbcbc"}}
    }}
    submitButtonStyles={{
      "submit": {
        "container": {
          "default": {"bottom": "0.7rem"}
        },
        "svg": {
          "styles": {
            "default": {
              "filter": "brightness(0) saturate(100%) invert(70%) sepia(52%) saturate(5617%) hue-rotate(185deg) brightness(101%) contrast(101%)"
            }
          }
        }
      }
    }}
    auxiliaryStyle="::-webkit-scrollbar {
            width: 10px;
            height: 10px;
          }
          ::-webkit-scrollbar-thumb {
            background-color: grey;
            border-radius: 5px;
          }
          ::-webkit-scrollbar-track {
            background-color: unset;
          }"
    initialMessages={[
      {"text": "Hello! How are you?", "role": "assistant"},
    ]}
    stream={true}
    request={{
      url: '/v1/chat/completions',
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
    responseInterceptor={(details: any) => ({ text: details.choices[0].delta.content })}

  >
    {showIntroPanel && <div
      style={{
        width: '200px',
        backgroundColor: '#f3f3f3',
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
