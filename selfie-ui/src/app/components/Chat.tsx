"use client";

import dynamic from "next/dynamic";

const DeepChat = dynamic(
  () => import('deep-chat-react-dev').then((mod) => ({ default: mod.DeepChat })),
  { ssr: false }
);

import React from "react";
import type { OpenAIChat } from "deep-chat-dev/dist/types/openAI";

export const Chat = ({ assistantName = "Assistant", assistantBio = "", userName = "User", disableAugmentation = false, shouldClear = false }) =>
  <DeepChat
      clearMessages={(shouldClear)=>{}}
      key={`${assistantName}-${assistantBio}-${userName}-${disableAugmentation}`} // Force re-render when props are changed
      style={{ borderRadius: '10px', border: 'unset', backgroundColor: '#292929', width: '100%', maxWidth: 'inherit', display: 'block' }}
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
      directConnection={{
        openAI: {
          chat: {
            model: '',
            system_prompt: `You are ${assistantName}, chatting with ${userName} in a fictional roleplay in which you are playing yourself. Write 1 reply only. Be proactive, creative, and drive the plot and conversation forward. Write at least 1 sentence, up to 4. Always stay in character and avoid repetition.${ assistantBio ? `\n${assistantBio}` : ''}`,
            stop: ['[END]', '[INST]', '[/INST]'],
            temperature: 0.3,
            frequency_penalty: 0.7,
            presence_penalty: 0.7,
            top_p: 1,
            max_tokens: 350,
          } as OpenAIChat,
          key: 'ignored'
        }
      }}
      request={{
          url: 'http://localhost:8181/v1/chat/completions',
          additionalBodyProps: {
            disable_augmentation: disableAugmentation,

            /** Uncomment and edit to use a local OpenAI-compatible API, e.g. text-generation-webui on localhost:5000.
            api_base: 'http://localhost:5000/v1',
            // When api_base refers to a local text-generation-webui API, we need to specify the instruction template.
            instruction_template: 'mistral',
            **/
          },
        }}
    />
