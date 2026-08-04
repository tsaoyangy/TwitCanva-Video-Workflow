import { AIMessage } from "@langchain/core/messages";
import { CHAT_AGENT_SYSTEM_PROMPT, TOPIC_GENERATION_PROMPT } from "../prompts/system.js";
import { createSeedChatCompletion } from "../../services/ark.js";

async function invokeChat(messages, apiKey, systemPrompt) {
    if (!apiKey) {
        throw new Error("Missing API key for chat graph");
    }

    const normalizedMessages = [
        { role: 'system', content: systemPrompt },
        ...messages.map((message) => ({
            role: message._getType?.() === 'ai' ? 'assistant' : 'user',
            content: message.content
        }))
    ];

    const { text } = await createSeedChatCompletion({
        apiKey,
        messages: normalizedMessages,
        temperature: 0.7,
        maxTokens: 2048
    });

    return text;
}

export function createChatGraph() {
    return {
        async invoke(state, config) {
            const text = await invokeChat(
                state.messages || [],
                config?.configurable?.apiKey,
                CHAT_AGENT_SYSTEM_PROMPT
            );

            return {
                messages: [new AIMessage(text)]
            };
        }
    };
}

export async function generateTopicTitle(messages, apiKey) {
    const text = await invokeChat(messages, apiKey, TOPIC_GENERATION_PROMPT);
    return text.split('\n')[0].trim() || 'New Chat';
}
