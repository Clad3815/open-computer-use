import axios from "axios";
import { generateText, generateObject, tool } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import fs from "fs";
import express from "express";
import cors from "cors";
import puppeteer from 'puppeteer';
import { v4 as uuidv4 } from "uuid";
import imageSize from 'image-size';
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from 'url';
// Install strip-ansi with: npm install strip-ansi
import stripAnsi from 'strip-ansi';
dotenv.config();

// ES module equivalent for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Cache for screenshot descriptions
const screenshotDescriptionCache = new Map();
let isTaskDone = false;
let isWaitingForUserResponse = false;
// Request tracking system
const activeRequests = new Map();

// Initialization of the Express application
const app = express();
const PORT = 2977;

// Middleware
app.use(cors());
app.use(express.json());
const google = createGoogleGenerativeAI({ apiKey: process.env.GOOGLE_API_KEY, timeout: 10000 });
const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 10000 });
const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 10000 });
// Global state for fallback
let isInFallbackMode = false;
let globalMessages = []; // Global variable to store messages
let consecutiveWaitCount = 0; // Track consecutive wait actions

// -- Configuration ------------------------------------------------------------

const CONFIG = {
    BASE_PROMPT_PATH: "./prompts/base.txt",
    CLIENT_HISTORY_FILE_PATH: "./client_history.json",
    MESSAGES_HISTORY_FILE_PATH: "./messages_history.json",
    SETTINGS_FILE_PATH: "./settings.json",
    VNC_SERVER_URL: "http://localhost:5000",
    PARSER_API_URL: "http://localhost:8000/parse/",
    DELAYS: {
        ACTION_MS: 2000,
        TYPING_MS: 20,
        WAIT_MULTIPLIER: 3,
        SCROLL_WAIT_MS: 300,
    },
    SCROLL: {
        AMOUNT: 300,
        MAX_ATTEMPTS: 20,
        CASE_SENSITIVE: false,
    },
    DRAG_DURATION_SECONDS: 0.3,
    MAX_IMAGES_IN_HISTORY: 3,
    MAX_SCREEN_INFO_IN_HISTORY: 10,
    MAX_SITUATION_ANALYSIS_IN_HISTORY: 10,
    SEND_PARSED_SCREENSHOT: false,
    SEND_SCREENSHOT: true,
    CONVERT_SCREENSHOT_TO_DESCRIPTION: false,
    TEMPERATURE: 0.7, // Temperature parameter for the AI
    PRICE_PER_MILLION_TOKENS: {
        "gemini-2.0-flash": {
            PROMPT: 0.10,
            COMPLETION: 0.40,
        },
        "gemini-2.5-flash": {
            PROMPT: 0.3,
            COMPLETION: 2.5,
        },
        "gemini-2.5-pro": {
            PROMPT: 1.25,
            COMPLETION: 10,
        },
        "gpt-4o": {
            PROMPT: 2.5,
            COMPLETION: 10,
        },
        "gpt-4.1": {
            PROMPT: 2,
            COMPLETION: 8,
        },
        "o3-mini": {
            PROMPT: 1.1,
            COMPLETION: 4.4,
        },
        "o3": {
            PROMPT: 2,
            COMPLETION: 8,
        },
        "claude-3-7-sonnet-latest": {
            PROMPT: 3,
            COMPLETION: 15,
        },
    },
    AI_MODEL: "google/gemini-2.0-pro-exp-02-05",
};

// -- Settings Management ------------------------------------------------------

// List of settings editable via the interface
const EDITABLE_SETTINGS = [
    'AI_MODEL',
    'TEMPERATURE',
    'SEND_SCREENSHOT',
    'SEND_PARSED_SCREENSHOT',
    'CONVERT_SCREENSHOT_TO_DESCRIPTION',
    'MAX_IMAGES_IN_HISTORY',
    'MAX_SCREEN_INFO_IN_HISTORY',
    'MAX_SITUATION_ANALYSIS_IN_HISTORY'
];

// Loads settings from the file
function loadSettings() {
    try {
        if (fs.existsSync(CONFIG.SETTINGS_FILE_PATH)) {
            const data = fs.readFileSync(CONFIG.SETTINGS_FILE_PATH, "utf8");
            const settings = JSON.parse(data);

            // Updates CONFIG with loaded settings
            EDITABLE_SETTINGS.forEach(key => {
                if (settings[key] !== undefined) {
                    CONFIG[key] = settings[key];
                }
            });

            console.log("Settings loaded successfully");
        } else {
            // If the file does not exist, create it with default values
            saveSettings();
        }
    } catch (error) {
        console.error("Error loading settings:", error);
    }
}

// Saves settings to the file
function saveSettings() {
    try {
        // Extracts only editable settings
        const settingsToSave = {};
        EDITABLE_SETTINGS.forEach(key => {
            settingsToSave[key] = CONFIG[key];
        });

        fs.writeFileSync(CONFIG.SETTINGS_FILE_PATH, JSON.stringify(settingsToSave, null, 2));
        console.log("Settings saved successfully");
    } catch (error) {
        console.error("Error saving settings:", error);
    }
}

// Tries to load settings on startup
loadSettings();

// Before loading the base prompt
function getScreenshotPromptSuffix() {
    const prefix = "\n\nFor each interaction, you will receive the following information:\n1. A list of all detected bounding boxes by IDs on the screen and their descriptions. Only elements with interactivity=true are interactive; the rest are non-interactive (for context only).";

    if (CONFIG.SEND_SCREENSHOT && CONFIG.SEND_PARSED_SCREENSHOT) {
        if (CONFIG.CONVERT_SCREENSHOT_TO_DESCRIPTION) {
            return `${prefix}\n2. Two screenshots:\n   - The current screen\n   - The same screenshot with bounding boxes drawn on it, to help you understand the position of elements on the screen`;
        } else {
            return `${prefix}\n2. Two screenshots:\n   - The current screen\n   - The same screenshot with bounding boxes drawn on it, to help you understand the position of elements on the screen`;
        }
    } else if (CONFIG.SEND_SCREENSHOT) {
        if (CONFIG.CONVERT_SCREENSHOT_TO_DESCRIPTION) {
            return `${prefix}\n2. A full description of what can be seen on the current screen`;
        } else {
            return `${prefix}\n2. A screenshot of the current screen`;
        }
    } else if (CONFIG.SEND_PARSED_SCREENSHOT) {
        if (CONFIG.CONVERT_SCREENSHOT_TO_DESCRIPTION) {
            return `${prefix}\n2. A full description of what can be seen on the current screen`;
        } else {
            return `${prefix}\n2. A screenshot with bounding boxes drawn on it, to help you understand the position of elements on the screen`;
        }
    } else {
        return prefix;
    }
}

// Convert a screenshot to a text description
async function convertScreenshotToDescription(screenshot) {
    const { object } = await generateObject({
        model: google("gemini-2.0-flash", {
            structuredOutputs: true,
        }),
        messages: [
            {
                role: "system",
                content: `You will be given a screenshot of a Windows computer desktop. Your task is to provide a detailed description of everything visible in the image. Pay close attention to all elements and details. Here's how to approach this task:

1. First, you will be provided with the screenshot

2. Carefully examine the entire image, starting from the top-left corner and moving systematically across and down the screen.

3. In your description, identify and describe the following elements (if present):

- Opened applications or windows (including their titles and content)
- Desktop icons
- Taskbar items
- System tray icons
- Start menu (if open)
- Cursor position
- Scrollbar positions in any visible windows
- Wallpaper or background
- Any visible notifications or pop-ups
- Time and date display
- Any other visible elements or features

4. Be as thorough and accurate as possible. Mention colors, sizes, and positions of elements where relevant. If text is visible and legible, include it in your description.

5. If you're unsure about any element or its purpose, state that you're unsure and describe what you see to the best of your ability.

Remember, the goal is to provide a comprehensive description that would allow someone who cannot see the image to understand exactly what is displayed on the screen.
Be objective and focus on describing what you see rather than interpreting or making assumptions about the user's actions or intentions.`,
            },
            {
                role: "user",
                content: [
                    {
                        type: "image",
                        image: `data:image/png;base64,${screenshot}`,
                    },
                    {
                        type: "text",
                        text: "This is the screenshot of the current screen",
                    },
                ],
            },
        ],
        schema: z.object({
            description: z.string().describe("A text description of the screenshot"),
        }),
    });
    return object.description;
}

// Loading and modifying the base prompt
const BASE_PROMPT = fs.readFileSync(CONFIG.BASE_PROMPT_PATH, "utf8").replace("{{SCREENSHOT_PROMPT_SUFFIX}}", getScreenshotPromptSuffix());

// -- Global State Management -------------------------------------------------

let clientHistory = [];

// Request Cost Tracking
let totalRequestPrice = {
    promptPrice: 0,
    completionPrice: 0,
    totalPrice: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
};

/**
 * Formats a number as a price with 6 decimals.
 * @param {number} price - The price to format.
 * @returns {string} The formatted price.
 */
function formatPrice(price) {
    return Number(price).toFixed(6);
}

// -- History Management --------------------------------------------------

function saveClientHistory() {
    try {
        fs.writeFileSync(CONFIG.CLIENT_HISTORY_FILE_PATH, JSON.stringify(clientHistory, null, 2));
        console.log("Client history saved successfully");
    } catch (error) {
        console.error("Error saving client history:", error);
    }
}

function saveMessagesHistory() {
    try {
        fs.writeFileSync(CONFIG.MESSAGES_HISTORY_FILE_PATH, JSON.stringify(globalMessages, null, 2));
        console.log("Message history saved successfully");
    } catch (error) {
        console.error("Error saving message history:", error);
    }
}

function loadClientHistory() {
    try {
        if (fs.existsSync(CONFIG.CLIENT_HISTORY_FILE_PATH)) {
            const data = fs.readFileSync(CONFIG.CLIENT_HISTORY_FILE_PATH, "utf8");
            clientHistory = JSON.parse(data);
            console.log("Client history loaded successfully");
        }
    } catch (error) {
        console.error("Error loading client history:", error);
        clientHistory = [];
    }
}

function loadMessagesHistory() {
    try {
        if (fs.existsSync(CONFIG.MESSAGES_HISTORY_FILE_PATH)) {
            const data = fs.readFileSync(CONFIG.MESSAGES_HISTORY_FILE_PATH, "utf8");
            globalMessages = JSON.parse(data);
            console.log("Message history loaded successfully");
        }
    } catch (error) {
        console.error("Error loading message history:", error);
        globalMessages = [];
    }
}

// -- Utility Functions (AI, actions, parsing, etc.) -----------------------

// Singleton Puppeteer browser instance
let browserInstance = null;

async function initializeBrowser() {
    if (!browserInstance) {
        browserInstance = await puppeteer.launch({
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
            defaultViewport: { width: 1280, height: 720 },
            headless: "new",
        });
    }
    return browserInstance;
}

async function getScreenshotFromVNC() {
    const maxRetries = 3;
    let retries = 0;

    while (retries < maxRetries) {
        try {
            // Primary method: VNC server screenshot
            const response = await axios.get(`${CONFIG.VNC_SERVER_URL}/screenshot`, {
                responseType: "arraybuffer",
                timeout: 10000,
            });

            const buffer = Buffer.from(response.data, "binary");
            const dimensions = imageSize(buffer);
            const base64Image = buffer.toString("base64");

            isInFallbackMode = false;

            return {
                base64Image,
                width: dimensions.width,
                height: dimensions.height,
            };
        } catch (error) {
            console.error("Screenshot failed:", error.message);
            console.log("Trying Puppeteer fallback...");

            try {
                isInFallbackMode = true;
                const browser = await initializeBrowser();
                const page = await browser.newPage();
                const url = 'http://localhost:8006/vnc.html?view_only=1&autoconnect=1&resize=scale';

                await page.goto(url, {
                    waitUntil: 'networkidle2',
                    timeout: 30000,
                });

                await new Promise(resolve => setTimeout(resolve, 2000));

                const screenshotBuffer = Buffer.from(
                    await page.screenshot({ encoding: 'binary', type: 'png' })
                );
                const dimensions = imageSize(screenshotBuffer);
                const base64Image = screenshotBuffer.toString('base64');

                await page.close();

                return {
                    base64Image,
                    width: dimensions.width,
                    height: dimensions.height,
                };
            } catch (puppeteerError) {
                console.error("Puppeteer fallback failed:", puppeteerError.message);
                retries++;
                await new Promise(resolve => setTimeout(resolve, 5000 * retries)); // Exponential backoff
            }
        }
    }
    throw new Error("Failed to capture screenshot after maximum retries");
}

async function parseScreenshot(base64Image) {
    try {
        const response = await axios.post(CONFIG.PARSER_API_URL, {
            base64_image: base64Image,
        });
        return response.data;
    } catch (error) {
        console.error("Error parsing the capture:", error);
        throw error;
    }
}

function calculateRequestPrice(usage, model) {
    const pricing = CONFIG.PRICE_PER_MILLION_TOKENS[model] || {
        PROMPT: 0,
        COMPLETION: 0,
    };

    const promptPrice = (usage.promptTokens / 1_000_000) * pricing.PROMPT;
    const completionPrice = (usage.completionTokens / 1_000_000) * pricing.COMPLETION;
    const totalPrice = promptPrice + completionPrice;

    totalRequestPrice.promptPrice += promptPrice;
    totalRequestPrice.completionPrice += completionPrice;
    totalRequestPrice.totalPrice += totalPrice;
    totalRequestPrice.promptTokens += usage.promptTokens;
    totalRequestPrice.completionTokens += usage.completionTokens;
    totalRequestPrice.totalTokens += usage.totalTokens;

    return {
        promptPrice,
        completionPrice,
        totalPrice,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        totalTokens: usage.totalTokens,
    };
}


/**
 * Cleans PowerShell output by removing ANSI escape sequences and other control characters,
 * making the output more readable in JSON responses
 * @param {string} output - The raw PowerShell output string
 * @returns {string} The cleaned output string
 */
function cleanPowerShellOutput(output) {
    if (!output) return "";

    try {
        // Step 2: Removal of all ANSI escape sequences
        let cleaned = stripAnsi(output);

        // Step 3: Removal of carriage returns without newline (avoids duplication)
        cleaned = cleaned.replace(/\r(?!\n)/g, '');

        // Step 4: Replacement of special Unicode characters
        cleaned = cleaned.replace(/[\u2500-\u257F]/g, '-'); // Box drawing characters
        cleaned = cleaned.replace(/[\u2580-\u259F]/g, '#'); // Block elements
        cleaned = cleaned.replace(/â–ˆ/g, '#');            // Specific block often present
        cleaned = cleaned.replace(/â€"/g, '-');            // Em dash

        // Step 5: Normalization of spaces (preserves newlines)
        cleaned = cleaned.replace(/[ \t]+/g, ' ');        // Reduces multiple spaces
        cleaned = cleaned.replace(/\n[\s\t]*\n+/g, '\n\n'); // Reduces empty lines

        // Step 6: Truncate long outputs
        const MAX_LENGTH = 10000;
        if (cleaned.length > MAX_LENGTH) {
            const firstHalf = cleaned.substring(0, 5000);
            const secondHalf = cleaned.substring(cleaned.length - 5000);
            cleaned = firstHalf + "\n[...output truncated...]\n" + secondHalf;
            console.log(`PowerShell output truncated from ${output.length} to ${MAX_LENGTH} characters`);
        }

        return cleaned.trim();
    } catch (error) {
        // Fallback in case of error (e.g., if strip-ansi is not installed)
        console.error("Error in cleanPowerShellOutput:", error);

        // Fallback version without strip-ansi
        let fallbackCleaned = output.replace(/\u0000/g, '');
        fallbackCleaned = fallbackCleaned.replace(/\u001b\[\??[0-9;]*[a-zA-Z]/g, '');
        fallbackCleaned = fallbackCleaned.replace(/\u001b\][0-9];.*?(\u0007|\u001b\\)/g, '');
        fallbackCleaned = fallbackCleaned.replace(/\u001b[ABCDEFGHJKSTU]/g, '');

        return fallbackCleaned.trim();
    }
}

// Simple configuration of supported models
const SUPPORTED_MODELS = {
    'openai': (modelName) => openai(modelName, {
        structuredOutputs: true,
    }),
    'google': (modelName) => google(modelName, {
        structuredOutputs: true,
    }),
    'anthropic': (modelName) => anthropic(modelName)
};

function getAIModel(modelString) {
    const [provider, fullModelName] = modelString.split('/');

    if (!provider || !fullModelName) {
        throw new Error('Invalid model format. Use: "provider/model-name"');
    }

    let modelName = fullModelName;
    let providerOptions = {};

    // Handling special models with specific options
    if (provider.toLowerCase() === 'openai') {
        if (fullModelName.startsWith('o3-mini-low')) {
            modelName = 'o3-mini';
            providerOptions = { reasoningEffort: 'low' };
        } else if (fullModelName.startsWith('o3-mini-high')) {
            modelName = 'o3-mini';
            providerOptions = { reasoningEffort: 'high' };
        } else if (fullModelName.startsWith('o3-mini')) {
            modelName = 'o3-mini';
            providerOptions = { reasoningEffort: 'medium' };
        } else if (fullModelName.startsWith('o3-low')) {
            modelName = 'o3';
            providerOptions = { reasoningEffort: 'low' };
        } else if (fullModelName.startsWith('o3-high')) {
            modelName = 'o3';
            providerOptions = { reasoningEffort: 'high' };
        } else if (fullModelName.startsWith('o3')) {
            modelName = 'o3';
            providerOptions = { reasoningEffort: 'medium' };
        } else if (fullModelName.startsWith('o4-mini-low')) {
            modelName = 'o4-mini';
            providerOptions = { reasoningEffort: 'low' };
        } else if (fullModelName.startsWith('o4-mini-high')) {
            modelName = 'o4-mini';
            providerOptions = { reasoningEffort: 'high' };
        } else if (fullModelName.startsWith('o4-mini')) {
            modelName = 'o4-mini';
            providerOptions = { reasoningEffort: 'medium' };
        }
    } else if (provider.toLowerCase() === 'anthropic') {
        if (fullModelName.includes('-thinking')) {
            // Extract the base model name by removing "-thinking"
            modelName = fullModelName.replace('-thinking', '');
            providerOptions = {
                thinking: { type: 'enabled', budgetTokens: 12000 }
            };
        }
    }

    const createModel = SUPPORTED_MODELS[provider.toLowerCase()];
    if (!createModel) {
        throw new Error(`Unsupported provider: ${provider}`);
    }

    return {
        model: createModel(modelName),
        modelName: modelName,
        providerOptions: providerOptions
    };
}

/**
 * Checks the status of a PowerShell job
 * @param {string} jobId - The ID of the PowerShell job to check
 * @returns {Promise<Object>} - The job status
 */
async function checkPowershellJobStatus(jobId) {
    try {
        const response = await axios.get(`${CONFIG.VNC_SERVER_URL}/powershell_job/${jobId}`, {
            timeout: 10000
        });
        return response.data;
    } catch (error) {
        console.error(`Error checking PowerShell job ${jobId}:`, error.message);
        throw error;
    }
}

function getAITools(currentCapture, updateClientCallback) {
    const parsedContentList = currentCapture.parsedData.parsed_content_list;
    const imageWidth = currentCapture.screenshotData.width;
    const imageHeight = currentCapture.screenshotData.height;

    // Common tools available in both normal and fallback modes
    const commonTools = {
        wait_tool: tool({
            description: "Wait for a specified duration to allow for screen updates, loading processes, or animations to complete",
            parameters: z.object({
                situation_analysis: z.string().describe("Analysis of the current situation"),
                reasoning: z.string().describe("Reasoning behind why waiting is necessary"),
                action_description: z.string().describe("Description of what you're waiting for, formatted with markdown"),
                duration_multiplier: z.number().describe("Multiplier for wait duration (1-5, default: 1)")
            }),
            execute: async ({ reasoning, action_description, duration_multiplier = 1 }) => {
                console.log("Executing wait action");

                // Ensure the multiplier is within reasonable bounds
                const safeMultiplier = Math.max(1, Math.min(5, duration_multiplier));
                const waitTime = CONFIG.DELAYS.ACTION_MS * CONFIG.DELAYS.WAIT_MULTIPLIER * safeMultiplier;

                // Create initial action object without end_time
                const initialAction = {
                    text: action_description,
                    start_time: Date.now(),
                    end_time: null,
                    action_type: "wait",
                    box_id: null,
                    value: null,
                    metadata: {
                        screenshot_base64: `data:image/png;base64,${currentCapture.screenshotData.base64Image}`,
                        parsed_screenshot_base64: `data:image/png;base64,${currentCapture.parsedData.som_image_base64}`,
                        actionData: {
                            reasoning,
                            action_description,
                            duration_multiplier: safeMultiplier
                        }
                    }
                };

                // Send initial update to client
                if (updateClientCallback) {
                    updateClientCallback(initialAction);
                }

                // Perform the wait
                await new Promise((resolve) => setTimeout(resolve, waitTime));

                // Update action with end_time and result
                const finalAction = {
                    ...initialAction,
                    end_time: Date.now(),
                    metadata: {
                        ...initialAction.metadata,
                        toolResult: {
                            status: "success",
                            message: `Waited for ${waitTime}ms`
                        }
                    }
                };

                // Send final update to client
                if (updateClientCallback) {
                    updateClientCallback(finalAction);
                }

                return {
                    status: "success",
                    action_type: "wait",
                    message: `Waited for ${waitTime}ms`
                };
            },
        }),
        message_notify_user: tool({
            description: "Send a message to user without requiring a response. Use for acknowledging receipt of messages, providing progress updates, reporting task completion, or explaining changes in approach.",
            parameters: z.object({
                text: z.string().describe("Message text to display to user"),
                attachments: z.union([
                    z.string(),
                    z.array(z.string())
                ]).describe("(Optional) List of attachments to show to user, can be file paths or URLs")
            }),
            execute: async ({ text, attachments }) => {
                console.log("Sending notification to user:", text);

                // Create a notification object
                const notification = {
                    text: text,
                    timestamp: Date.now(),
                    type: "notification",
                    attachments: attachments || []
                };

                // Send notification to the client
                if (updateClientCallback) {
                    const notificationAction = {
                        text: text,
                        start_time: Date.now(),
                        end_time: Date.now(),
                        action_type: "message_notify_user",
                        box_id: null,
                        value: null,
                        metadata: {
                            notification: notification,
                            screenshot_base64: `data:image/png;base64,${currentCapture.screenshotData.base64Image}`
                        }
                    };

                    updateClientCallback(notificationAction);
                }

                return {
                    status: "success",
                    message: "The user has been notified!"
                };
            },
        }),
        message_ask_user: tool({
            description: "Ask user a question and wait for response. Use for requesting clarification, asking for confirmation, or gathering additional information.",
            parameters: z.object({
                text: z.string().describe("Question text to present to user"),
                attachments: z.union([
                    z.string(),
                    z.array(z.string())
                ]).describe("(Optional) List of question-related files or reference materials")
            }),
            execute: async ({ text, attachments }) => {
                console.log("Asking user:", text);
                isWaitingForUserResponse = true;

                // Create a question object
                const question = {
                    text: text,
                    timestamp: Date.now(),
                    type: "question",
                    attachments: attachments || []
                };

                // Send the question to the client
                if (updateClientCallback) {
                    const questionAction = {
                        text: text,
                        start_time: Date.now(),
                        end_time: Date.now(),
                        action_type: "message_ask_user",
                        box_id: null,
                        value: null,
                        metadata: {
                            question: question,
                            screenshot_base64: `data:image/png;base64,${currentCapture.screenshotData.base64Image}`
                        }
                    };

                    updateClientCallback(questionAction);
                }

                return {
                    status: "wait_for_user_response",
                    message: "Waiting for user response..."
                };
            },
        }),
        task_done: tool({
            description: "Indicate that the task is completed",
            parameters: z.object({}),
            execute: async () => {
                console.log("Task completed");
                isTaskDone = true;
                return {
                    status: "completed",
                    message: "Task completed, you can now notify the user"
                };
            },
        }),
    };

    // If in fallback mode, only return common tools
    if (isInFallbackMode) {
        return commonTools;
    }

    // If not in fallback mode, add tools only available in normal mode
    return {
        ...commonTools,
        send_powershell_command: tool({
            description: "Execute a PowerShell command on the Windows computer",
            parameters: z.object({
                situation_analysis: z.string().describe("Analysis of the current situation"),
                reasoning: z.string().describe("Reasoning behind the chosen command"),
                action_description: z.string().describe("Description of what the command will do, formatted with markdown"),
                command: z.string().describe("The PowerShell command to execute")
            }),
            execute: async ({ command, reasoning, action_description, save_information }) => {
                console.log("Executing PowerShell command:", command);

                // Create an initial action object without end_time
                const initialAction = {
                    text: action_description,
                    start_time: Date.now(),
                    end_time: null,
                    action_type: "exec_powershell_cmd",
                    value: command,
                    box_id: null,
                    metadata: {
                        screenshot_base64: `data:image/png;base64,${currentCapture.screenshotData.base64Image}`,
                        parsed_screenshot_base64: `data:image/png;base64,${currentCapture.parsedData.som_image_base64}`,
                        actionData: {
                            reasoning,
                            action_description,
                            command,
                            save_information
                        }
                    }
                };

                // Send the initial update to the client
                if (updateClientCallback) {
                    updateClientCallback(initialAction);
                }

                try {
                    // Execute the command
                    const result = await sendPowershellCommand(command);

                    // Check if it's a long-running task
                    if (result.is_long_running) {
                        // Update the action with long-running task information
                        const longRunningAction = {
                            ...initialAction,
                            metadata: {
                                ...initialAction.metadata,
                                toolResult: {
                                    output: result.output,
                                    job_id: result.job_id,
                                    status: result.status,
                                    is_long_running: true,
                                    current_output: result.current_output,
                                    current_error: result.current_error
                                }
                            }
                        };

                        // Send the update to the client
                        if (updateClientCallback) {
                            updateClientCallback(longRunningAction);
                        }

                        return {
                            output: result.output,
                            job_id: result.job_id,
                            status: result.status,
                            is_long_running: true,
                            current_output: result.current_output,
                            current_error: result.current_error
                        };
                    }

                    // If it's a standard command that finished, proceed as before
                    // Add a delay after executing the PowerShell command
                    await new Promise((resolve) => setTimeout(resolve, CONFIG.DELAYS.ACTION_MS));

                    // Update the action with results and end_time
                    const finalAction = {
                        ...initialAction,
                        end_time: Date.now(),
                        metadata: {
                            ...initialAction.metadata,
                            toolResult: {
                                output: cleanPowerShellOutput(result.output),
                                error: result.error ? cleanPowerShellOutput(result.error) : null,
                                returncode: result.returncode,
                                screen_recording_job_id: result.screen_recording_job_id
                            }
                        }
                    };

                    // Send the final update to the client
                    if (updateClientCallback) {
                        updateClientCallback(finalAction);
                    }

                    // Fetch and save screen recording if job ID is available
                    if (result.screen_recording_job_id) {
                        fetchAndSaveScreenRecording(result.screen_recording_job_id, finalAction)
                            .catch(console.error)
                            .then(() => {
                                if (updateClientCallback) {
                                    updateClientCallback(finalAction);
                                }
                            });
                    }

                    return {
                        output: cleanPowerShellOutput(result.output),
                        error: result.error ? cleanPowerShellOutput(result.error) : null,
                        returncode: result.returncode
                    };
                } catch (error) {
                    return {
                        message: "Command failed",
                        error: error.message
                    }
                }
            },
        }),

        check_powershell_status: tool({
            description: "Check the status of a long-running PowerShell command",
            parameters: z.object({
                situation_analysis: z.string().describe("Analysis of the current situation"),
                reasoning: z.string().describe("Reasoning behind checking this command status"),
                action_description: z.string().describe("Description of what this check will do, formatted with markdown"),
                job_id: z.string().describe("The job ID of the PowerShell command to check")
            }),
            execute: async ({ job_id, reasoning, action_description }) => {
                console.log(`Checking PowerShell job status for: ${job_id}`);

                // Create an initial action object
                const initialAction = {
                    text: action_description,
                    start_time: Date.now(),
                    end_time: null,
                    action_type: "check_powershell_status",
                    value: job_id,
                    box_id: null,
                    metadata: {
                        screenshot_base64: `data:image/png;base64,${currentCapture.screenshotData.base64Image}`,
                        parsed_screenshot_base64: `data:image/png;base64,${currentCapture.parsedData.som_image_base64}`,
                        actionData: {
                            reasoning,
                            action_description,
                            job_id
                        }
                    }
                };

                // Send the initial update to the client
                if (updateClientCallback) {
                    updateClientCallback(initialAction);
                }

                try {
                    // Retrieve the job status
                    const response = await axios.get(`${CONFIG.VNC_SERVER_URL}/powershell_job/${job_id}`);
                    const jobStatus = response.data;

                    // Update the action with the results
                    const finalAction = {
                        ...initialAction,
                        end_time: Date.now(),
                        metadata: {
                            ...initialAction.metadata,
                            toolResult: {
                                status: jobStatus.status,
                                output: cleanPowerShellOutput(jobStatus.output || ""),
                                error: jobStatus.error ? cleanPowerShellOutput(jobStatus.error) : null,
                                returncode: jobStatus.returncode
                            }
                        }
                    };

                    // Send the final update to the client
                    if (updateClientCallback) {
                        updateClientCallback(finalAction);
                    }

                    // Determine if the job is finished
                    const isCompleted = jobStatus.status === 'completed' || jobStatus.status === 'error';

                    return {
                        status: jobStatus.status,
                        output: cleanPowerShellOutput(jobStatus.output || ""),
                        error: jobStatus.error ? cleanPowerShellOutput(jobStatus.error) : null,
                        returncode: jobStatus.returncode,
                        is_completed: isCompleted
                    };
                } catch (error) {
                    console.error(`Error checking PowerShell job ${job_id}:`, error);

                    // Update the action with the error
                    const errorAction = {
                        ...initialAction,
                        end_time: Date.now(),
                        metadata: {
                            ...initialAction.metadata,
                            toolResult: {
                                status: 'error',
                                error: `Error checking status: ${error.message}`
                            }
                        }
                    };

                    // Send the final update to the client
                    if (updateClientCallback) {
                        updateClientCallback(errorAction);
                    }

                    return {
                        status: 'error',
                        error: `Error checking status: ${error.message}`,
                        is_completed: false
                    };
                }
            },
        }),

        send_powershell_input: tool({
            description: "Send input to an interactive PowerShell command that is waiting for user input",
            parameters: z.object({
                situation_analysis: z.string().describe("Analysis of the current situation"),
                reasoning: z.string().describe("Reasoning behind sending this input"),
                action_description: z.string().describe("Description of what this input will accomplish, formatted with markdown"),
                job_id: z.string().describe("The job ID of the running PowerShell command"),
                input: z.string().describe("The input text to send to the PowerShell command")
            }),
            execute: async ({ job_id, input, reasoning, action_description }) => {
                console.log(`Sending input to PowerShell job ${job_id}: "${input}"`);

                // Create an initial action object
                const initialAction = {
                    text: action_description,
                    start_time: Date.now(),
                    end_time: null,
                    action_type: "send_powershell_input",
                    value: `${job_id}: ${input}`,
                    box_id: null,
                    metadata: {
                        screenshot_base64: `data:image/png;base64,${currentCapture.screenshotData.base64Image}`,
                        parsed_screenshot_base64: `data:image/png;base64,${currentCapture.parsedData.som_image_base64}`,
                        actionData: {
                            reasoning,
                            action_description,
                            job_id,
                            input
                        }
                    }
                };

                // Send the initial update to the client
                if (updateClientCallback) {
                    updateClientCallback(initialAction);
                }

                try {
                    // Send input to the PowerShell job
                    const response = await axios.post(`${CONFIG.VNC_SERVER_URL}/powershell_job/${job_id}/input`, {
                        input: input
                    });

                    // Add a short delay to allow the server time to process the input
                    await new Promise((resolve) => setTimeout(resolve, CONFIG.DELAYS.ACTION_MS / 2));

                    // Get the updated status after sending the input
                    const statusResponse = await axios.get(`${CONFIG.VNC_SERVER_URL}/powershell_job/${job_id}`);
                    const jobStatus = statusResponse.data;

                    // Update the action with the results
                    const finalAction = {
                        ...initialAction,
                        end_time: Date.now(),
                        metadata: {
                            ...initialAction.metadata,
                            toolResult: {
                                status: 'success',
                                message: response.data.message || 'Input sent successfully',
                                current_job_status: jobStatus.status,
                                current_output: cleanPowerShellOutput(jobStatus.output || "")
                            }
                        }
                    };

                    // Send the final update to the client
                    if (updateClientCallback) {
                        updateClientCallback(finalAction);
                    }

                    return {
                        status: 'success',
                        message: response.data.message || 'Input sent successfully',
                        current_job_status: jobStatus.status,
                        current_output: cleanPowerShellOutput(jobStatus.output || "")
                    };
                } catch (error) {
                    console.error(`Error sending input to PowerShell job ${job_id}:`, error);

                    // Update the action with the error
                    const errorAction = {
                        ...initialAction,
                        end_time: Date.now(),
                        metadata: {
                            ...initialAction.metadata,
                            toolResult: {
                                status: 'error',
                                error: `Error sending input: ${error.message}`
                            }
                        }
                    };

                    // Send the final update to the client
                    if (updateClientCallback) {
                        updateClientCallback(errorAction);
                    }

                    return {
                        status: 'error',
                        error: `Error sending input: ${error.message}`
                    };
                }
            },
        }),
        kill_powershell_job: tool({
            description: "Terminate a running PowerShell command that is in progress",
            parameters: z.object({
                situation_analysis: z.string().describe("Analysis of the current situation"),
                reasoning: z.string().describe("Reasoning behind terminating this command"),
                action_description: z.string().describe("Description of why this PowerShell process needs to be terminated, formatted with markdown"),
                job_id: z.string().describe("The job ID of the PowerShell command to terminate")
            }),
            execute: async ({ job_id, reasoning, action_description }) => {
                console.log(`Terminating PowerShell job: ${job_id}`);

                // Create an initial action object
                const initialAction = {
                    text: action_description,
                    start_time: Date.now(),
                    end_time: null,
                    action_type: "kill_powershell_job",
                    value: job_id,
                    box_id: null,
                    metadata: {
                        screenshot_base64: `data:image/png;base64,${currentCapture.screenshotData.base64Image}`,
                        parsed_screenshot_base64: `data:image/png;base64,${currentCapture.parsedData.som_image_base64}`,
                        actionData: {
                            reasoning,
                            action_description,
                            job_id
                        }
                    }
                };

                // Send the initial update to the client
                if (updateClientCallback) {
                    updateClientCallback(initialAction);
                }

                try {
                    // Call the endpoint to kill the PowerShell process
                    const response = await axios.post(`${CONFIG.VNC_SERVER_URL}/powershell_job/${job_id}/kill`);

                    // Add a short delay after the action
                    await new Promise((resolve) => setTimeout(resolve, CONFIG.DELAYS.ACTION_MS / 2));

                    // Check the updated status after killing the process
                    let jobStatus = null;
                    try {
                        const statusResponse = await axios.get(`${CONFIG.VNC_SERVER_URL}/powershell_job/${job_id}`);
                        jobStatus = statusResponse.data;
                    } catch (statusError) {
                        console.warn(`Unable to retrieve job status after termination: ${statusError.message}`);
                    }

                    // Update the action with the results
                    const finalAction = {
                        ...initialAction,
                        end_time: Date.now(),
                        metadata: {
                            ...initialAction.metadata,
                            toolResult: {
                                status: response.data.status,
                                message: response.data.message,
                                job_status: jobStatus ? jobStatus.status : 'unknown',
                                job_output: jobStatus ? cleanPowerShellOutput(jobStatus.output || "") : null,
                                job_error: jobStatus && jobStatus.error ? cleanPowerShellOutput(jobStatus.error) : null
                            }
                        }
                    };

                    // Send the final update to the client
                    if (updateClientCallback) {
                        updateClientCallback(finalAction);
                    }

                    return {
                        status: response.data.status,
                        message: response.data.message,
                        job_id: job_id,
                        job_status: jobStatus ? jobStatus.status : 'unknown'
                    };
                } catch (error) {
                    console.error(`Error terminating PowerShell job ${job_id}:`, error);

                    // Update the action with the error
                    const errorAction = {
                        ...initialAction,
                        end_time: Date.now(),
                        metadata: {
                            ...initialAction.metadata,
                            toolResult: {
                                status: 'error',
                                error: `Error terminating process: ${error.message}`
                            }
                        }
                    };

                    // Send the final update to the client
                    if (updateClientCallback) {
                        updateClientCallback(errorAction);
                    }

                    return {
                        status: 'error',
                        error: `Error terminating process: ${error.message}`
                    };
                }
            },
        }),
        file_read_tool: tool({
            description: "Read file content from the Windows computer",
            parameters: z.object({
                situation_analysis: z.string().describe("Analysis of the current situation"),
                reasoning: z.string().describe("Reasoning behind reading this file"),
                file: z.string().describe("Absolute path of the file to read"),
                start_line: z.number().describe("Starting line to read from, 0-based"),
                end_line: z.number().describe("Ending line number (exclusive)"),
                action_description: z.string().describe("Description of what this action will do, formatted with markdown")
            }),
            execute: async ({ file, start_line, end_line, sudo, reasoning, action_description }) => {
                console.log(`Reading file: ${file}`);

                // Create initial action object
                const initialAction = {
                    text: action_description,
                    start_time: Date.now(),
                    end_time: null,
                    action_type: "file_read",
                    box_id: null,
                    value: file,
                    metadata: {
                        screenshot_base64: `data:image/png;base64,${currentCapture.screenshotData.base64Image}`,
                        parsed_screenshot_base64: `data:image/png;base64,${currentCapture.parsedData.som_image_base64}`,
                        actionData: {
                            reasoning,
                            action_description,
                            file,
                            start_line,
                            end_line,
                            sudo
                        }
                    }
                };

                // Send initial update to client
                if (updateClientCallback) {
                    updateClientCallback(initialAction);
                }

                // Execute the command using our new API
                const response = await axios.post(`${CONFIG.VNC_SERVER_URL}/file/read`, {
                    file,
                    start_line,
                    end_line,
                    sudo
                });

                const result = response.data;

                // Add delay after command execution
                await new Promise((resolve) => setTimeout(resolve, CONFIG.DELAYS.ACTION_MS));

                // Update action with results and end_time
                const finalAction = {
                    ...initialAction,
                    end_time: Date.now(),
                    metadata: {
                        ...initialAction.metadata,
                        toolResult: {
                            output: cleanPowerShellOutput(result.output),
                            error: result.error ? cleanPowerShellOutput(result.error) : null,
                            returncode: result.returncode,
                            screen_recording_job_id: result.screen_recording_job_id
                        }
                    }
                };

                // Send final update to client
                if (updateClientCallback) {
                    updateClientCallback(finalAction);
                }

                // Fetch and save screen recording if job ID is available
                if (result.screen_recording_job_id) {
                    fetchAndSaveScreenRecording(result.screen_recording_job_id, finalAction)
                        .catch(console.error)
                        .then(() => {
                            if (updateClientCallback) {
                                updateClientCallback(finalAction);
                            }
                        });
                }

                return {
                    output: cleanPowerShellOutput(result.output),
                    error: result.error ? cleanPowerShellOutput(result.error) : null,
                    returncode: result.returncode
                };
            },
        }),

        file_write_tool: tool({
            description: "Write or append content to a file on the Windows computer",
            parameters: z.object({
                situation_analysis: z.string().describe("Analysis of the current situation"),
                reasoning: z.string().describe("Reasoning behind writing to this file"),
                file: z.string().describe("Absolute path of the file to write to"),
                content: z.string().describe("Text content to write"),
                append: z.boolean().describe("Whether to use append mode (default: false)"),
                leading_newline: z.boolean().describe("Whether to add a leading newline (default: false)"),
                trailing_newline: z.boolean().describe("Whether to add a trailing newline (default: false)"),
                action_description: z.string().describe("Description of what this action will do, formatted with markdown")
            }),
            execute: async ({ file, content, append, leading_newline, trailing_newline, sudo, reasoning, action_description }) => {
                console.log(`Writing to file: ${file}, append: ${append}`);

                // Create initial action object
                const initialAction = {
                    text: action_description,
                    start_time: Date.now(),
                    end_time: null,
                    action_type: "file_write",
                    box_id: null,
                    value: file,
                    metadata: {
                        screenshot_base64: `data:image/png;base64,${currentCapture.screenshotData.base64Image}`,
                        parsed_screenshot_base64: `data:image/png;base64,${currentCapture.parsedData.som_image_base64}`,
                        actionData: {
                            reasoning,
                            action_description,
                            file,
                            content,
                            append,
                            leading_newline,
                            trailing_newline,
                            sudo
                        }
                    }
                };

                // Send initial update to client
                if (updateClientCallback) {
                    updateClientCallback(initialAction);
                }

                // Execute the command using our new API
                const response = await axios.post(`${CONFIG.VNC_SERVER_URL}/file/write`, {
                    file,
                    content,
                    append,
                    leading_newline,
                    trailing_newline,
                    sudo
                });

                const result = response.data;

                // Add delay after command execution
                await new Promise((resolve) => setTimeout(resolve, CONFIG.DELAYS.ACTION_MS));

                // Update action with results and end_time
                const finalAction = {
                    ...initialAction,
                    end_time: Date.now(),
                    metadata: {
                        ...initialAction.metadata,
                        toolResult: {
                            output: cleanPowerShellOutput(result.output),
                            error: result.error ? cleanPowerShellOutput(result.error) : null,
                            returncode: result.returncode,
                            screen_recording_job_id: result.screen_recording_job_id
                        }
                    }
                };

                // Send final update to client
                if (updateClientCallback) {
                    updateClientCallback(finalAction);
                }

                // Fetch and save screen recording if job ID is available
                if (result.screen_recording_job_id) {
                    fetchAndSaveScreenRecording(result.screen_recording_job_id, finalAction)
                        .catch(console.error)
                        .then(() => {
                            if (updateClientCallback) {
                                updateClientCallback(finalAction);
                            }
                        });
                }

                return {
                    output: cleanPowerShellOutput(result.output),
                    error: result.error ? cleanPowerShellOutput(result.error) : null,
                    returncode: result.returncode
                };
            },
        }),

        file_str_replace_tool: tool({
            description: "Replace specified string in a file on the Windows computer",
            parameters: z.object({
                situation_analysis: z.string().describe("Analysis of the current situation"),
                reasoning: z.string().describe("Reasoning behind replacing text in this file"),
                file: z.string().describe("Absolute path of the file to perform replacement on"),
                old_str: z.string().describe("Original string to be replaced"),
                new_str: z.string().describe("New string to replace with"),
                action_description: z.string().describe("Description of what this action will do, formatted with markdown")
            }),
            execute: async ({ file, old_str, new_str, sudo, reasoning, action_description }) => {
                console.log(`Replacing string in file: ${file}`);

                // Create initial action object
                const initialAction = {
                    text: action_description,
                    start_time: Date.now(),
                    end_time: null,
                    action_type: "file_str_replace",
                    box_id: null,
                    value: file,
                    metadata: {
                        screenshot_base64: `data:image/png;base64,${currentCapture.screenshotData.base64Image}`,
                        parsed_screenshot_base64: `data:image/png;base64,${currentCapture.parsedData.som_image_base64}`,
                        actionData: {
                            reasoning,
                            action_description,
                            file,
                            old_str,
                            new_str,
                            sudo
                        }
                    }
                };

                // Send initial update to client
                if (updateClientCallback) {
                    updateClientCallback(initialAction);
                }

                // Execute the command using our new API
                const response = await axios.post(`${CONFIG.VNC_SERVER_URL}/file/str_replace`, {
                    file,
                    old_str,
                    new_str,
                    sudo
                });

                const result = response.data;

                // Add delay after command execution
                await new Promise((resolve) => setTimeout(resolve, CONFIG.DELAYS.ACTION_MS));

                // Update action with results and end_time
                const finalAction = {
                    ...initialAction,
                    end_time: Date.now(),
                    metadata: {
                        ...initialAction.metadata,
                        toolResult: {
                            output: cleanPowerShellOutput(result.output),
                            error: result.error ? cleanPowerShellOutput(result.error) : null,
                            returncode: result.returncode,
                            screen_recording_job_id: result.screen_recording_job_id
                        }
                    }
                };

                // Send final update to client
                if (updateClientCallback) {
                    updateClientCallback(finalAction);
                }

                // Fetch and save screen recording if job ID is available
                if (result.screen_recording_job_id) {
                    fetchAndSaveScreenRecording(result.screen_recording_job_id, finalAction)
                        .catch(console.error)
                        .then(() => {
                            if (updateClientCallback) {
                                updateClientCallback(finalAction);
                            }
                        });
                }

                return {
                    output: cleanPowerShellOutput(result.output),
                    error: result.error ? cleanPowerShellOutput(result.error) : null,
                    returncode: result.returncode
                };
            },
        }),

        file_find_in_content_tool: tool({
            description: "Search for matching text within file content on the Windows computer",
            parameters: z.object({
                situation_analysis: z.string().describe("Analysis of the current situation"),
                reasoning: z.string().describe("Reasoning behind searching this file"),
                file: z.string().describe("Absolute path of the file to search within"),
                regex: z.string().describe("Regular expression pattern to match"),
                action_description: z.string().describe("Description of what this action will do, formatted with markdown")
            }),
            execute: async ({ file, regex, sudo, reasoning, action_description }) => {
                console.log(`Searching in file: ${file} with regex: ${regex}`);

                // Create initial action object
                const initialAction = {
                    text: action_description,
                    start_time: Date.now(),
                    end_time: null,
                    action_type: "file_find_in_content",
                    box_id: null,
                    value: file,
                    metadata: {
                        screenshot_base64: `data:image/png;base64,${currentCapture.screenshotData.base64Image}`,
                        parsed_screenshot_base64: `data:image/png;base64,${currentCapture.parsedData.som_image_base64}`,
                        actionData: {
                            reasoning,
                            action_description,
                            file,
                            regex,
                            sudo
                        }
                    }
                };

                // Send initial update to client
                if (updateClientCallback) {
                    updateClientCallback(initialAction);
                }

                // Execute the command using our new API
                const response = await axios.post(`${CONFIG.VNC_SERVER_URL}/file/find_in_content`, {
                    file,
                    regex,
                    sudo
                });

                const result = response.data;

                // Add delay after command execution
                await new Promise((resolve) => setTimeout(resolve, CONFIG.DELAYS.ACTION_MS));

                // Update action with results and end_time
                const finalAction = {
                    ...initialAction,
                    end_time: Date.now(),
                    metadata: {
                        ...initialAction.metadata,
                        toolResult: {
                            output: cleanPowerShellOutput(result.output),
                            matches: result.matches,
                            error: result.error ? cleanPowerShellOutput(result.error) : null,
                            returncode: result.returncode,
                            screen_recording_job_id: result.screen_recording_job_id
                        }
                    }
                };

                // Send final update to client
                if (updateClientCallback) {
                    updateClientCallback(finalAction);
                }

                // Fetch and save screen recording if job ID is available
                if (result.screen_recording_job_id) {
                    fetchAndSaveScreenRecording(result.screen_recording_job_id, finalAction)
                        .catch(console.error)
                        .then(() => {
                            if (updateClientCallback) {
                                updateClientCallback(finalAction);
                            }
                        });
                }

                return {
                    output: cleanPowerShellOutput(result.output),
                    matches: result.matches,
                    error: result.error ? cleanPowerShellOutput(result.error) : null,
                    returncode: result.returncode
                };
            },
        }),

        file_find_by_name_tool: tool({
            description: "Find files by name pattern in specified directory on the Windows computer",
            parameters: z.object({
                situation_analysis: z.string().describe("Analysis of the current situation"),
                reasoning: z.string().describe("Reasoning behind finding these files"),
                path: z.string().describe("Absolute path of directory to search"),
                glob: z.string().describe("Filename pattern using glob syntax wildcards"),
                action_description: z.string().describe("Description of what this action will do, formatted with markdown")
            }),
            execute: async ({ path, glob, reasoning, action_description }) => {
                console.log(`Finding files in: ${path} with pattern: ${glob}`);

                // Create initial action object
                const initialAction = {
                    text: action_description,
                    start_time: Date.now(),
                    end_time: null,
                    action_type: "file_find_by_name",
                    box_id: null,
                    value: `${path}/${glob}`,
                    metadata: {
                        screenshot_base64: `data:image/png;base64,${currentCapture.screenshotData.base64Image}`,
                        parsed_screenshot_base64: `data:image/png;base64,${currentCapture.parsedData.som_image_base64}`,
                        actionData: {
                            reasoning,
                            action_description,
                            path,
                            glob
                        }
                    }
                };

                // Send initial update to client
                if (updateClientCallback) {
                    updateClientCallback(initialAction);
                }

                // Execute the command using our new API
                const response = await axios.post(`${CONFIG.VNC_SERVER_URL}/file/find_by_name`, {
                    path,
                    glob
                });

                const result = response.data;

                // Add delay after command execution
                await new Promise((resolve) => setTimeout(resolve, CONFIG.DELAYS.ACTION_MS));

                // Update action with results and end_time
                const finalAction = {
                    ...initialAction,
                    end_time: Date.now(),
                    metadata: {
                        ...initialAction.metadata,
                        toolResult: {
                            output: cleanPowerShellOutput(result.output),
                            files: result.files,
                            count: result.count,
                            error: result.error ? cleanPowerShellOutput(result.error) : null,
                            returncode: result.returncode,
                            screen_recording_job_id: result.screen_recording_job_id
                        }
                    }
                };

                // Send final update to client
                if (updateClientCallback) {
                    updateClientCallback(finalAction);
                }

                // Fetch and save screen recording if job ID is available
                if (result.screen_recording_job_id) {
                    fetchAndSaveScreenRecording(result.screen_recording_job_id, finalAction)
                        .catch(console.error)
                        .then(() => {
                            if (updateClientCallback) {
                                updateClientCallback(finalAction);
                            }
                        });
                }

                return {
                    output: cleanPowerShellOutput(result.output),
                    files: result.files,
                    count: result.count,
                    error: result.error ? cleanPowerShellOutput(result.error) : null,
                    returncode: result.returncode
                };
            },
        }),

        // 1. MOUSE INTERACTION TOOLS

        mouse_click_tool: tool({
            description: "Execute mouse click actions on the Windows computer",
            parameters: z.object({
                situation_analysis: z.string().describe("Analysis of the current situation"),
                reasoning: z.string().describe("Reasoning behind the chosen action"),
                click_type: z.enum([
                    "left_click", "right_click", "double_click", "middle_click"
                ]).describe("The type of click to perform"),
                box_id: z.number().describe("The ID of the box to click on"),
                action_description: z.string().describe("Description of what the action will do, formatted with markdown"),
                save_information: z.boolean().describe("Save the information on the screen in the memory")
            }),
            execute: async ({ click_type, box_id, reasoning, action_description, save_information }) => {
                console.log(`Executing mouse ${click_type} on box_id: ${box_id}`);

                let coordinates = getBoxCoordinates(
                    box_id,
                    parsedContentList,
                    imageWidth,
                    imageHeight
                );

                // Create initial action object
                const initialAction = {
                    text: action_description,
                    start_time: Date.now(),
                    end_time: null,
                    action_type: click_type,
                    box_id,
                    value: null,
                    metadata: {
                        screenshot_base64: `data:image/png;base64,${currentCapture.screenshotData.base64Image}`,
                        parsed_screenshot_base64: `data:image/png;base64,${currentCapture.parsedData.som_image_base64}`,
                        actionData: {
                            reasoning,
                            action_description,
                            action: click_type,
                            box_id,
                            save_information
                        }
                    }
                };

                // Send initial update to client
                if (updateClientCallback) {
                    updateClientCallback(initialAction);
                }

                // Execute the command
                const pyCommand = convertActionToPyAutoGUI(
                    click_type,
                    coordinates,
                    null
                );

                const result = await sendCommandToVM(pyCommand);
                console.log("Command executed:", result);

                // Wait after the action
                await new Promise((resolve) => setTimeout(resolve, CONFIG.DELAYS.ACTION_MS));

                // Update action with results and end_time
                const finalAction = {
                    ...initialAction,
                    end_time: Date.now(),
                    metadata: {
                        ...initialAction.metadata,
                        toolResult: result
                    }
                };

                // Send final update to client
                if (updateClientCallback) {
                    updateClientCallback(finalAction);
                }

                // Fetch and save screen recording if job ID is available
                if (result.screen_recording_job_id) {
                    fetchAndSaveScreenRecording(result.screen_recording_job_id, finalAction)
                        .catch(console.error)
                        .then(() => {
                            if (updateClientCallback) {
                                updateClientCallback(finalAction);
                            }
                        });
                }

                return {
                    status: "success",
                    result
                };
            },
        }),

        mouse_hover_tool: tool({
            description: "Move the mouse cursor over an element without clicking",
            parameters: z.object({
                situation_analysis: z.string().describe("Analysis of the current situation"),
                reasoning: z.string().describe("Reasoning behind hovering over this element"),
                box_id: z.number().describe("The ID of the box to hover over"),
                action_description: z.string().describe("Description of what hovering will do, formatted with markdown"),
                save_information: z.boolean().describe("Save the information on the screen in the memory")
            }),
            execute: async ({ box_id, reasoning, action_description, save_information }) => {
                console.log(`Executing mouse hover on box_id: ${box_id}`);

                let coordinates = getBoxCoordinates(
                    box_id,
                    parsedContentList,
                    imageWidth,
                    imageHeight
                );

                // Create initial action object
                const initialAction = {
                    text: action_description,
                    start_time: Date.now(),
                    end_time: null,
                    action_type: "hover",
                    box_id,
                    value: null,
                    metadata: {
                        screenshot_base64: `data:image/png;base64,${currentCapture.screenshotData.base64Image}`,
                        parsed_screenshot_base64: `data:image/png;base64,${currentCapture.parsedData.som_image_base64}`,
                        actionData: {
                            reasoning,
                            action_description,
                            action: "hover",
                            box_id,
                            save_information
                        }
                    }
                };

                // Send initial update to client
                if (updateClientCallback) {
                    updateClientCallback(initialAction);
                }

                // Execute the command
                const pyCommand = convertActionToPyAutoGUI(
                    "hover",
                    coordinates,
                    null
                );

                const result = await sendCommandToVM(pyCommand);

                // Update action with results and end_time
                const finalAction = {
                    ...initialAction,
                    end_time: Date.now(),
                    metadata: {
                        ...initialAction.metadata,
                        toolResult: result
                    }
                };

                // Send final update to client
                if (updateClientCallback) {
                    updateClientCallback(finalAction);
                }

                // Fetch and save screen recording if job ID is available
                if (result.screen_recording_job_id) {
                    fetchAndSaveScreenRecording(result.screen_recording_job_id, finalAction)
                        .catch(console.error)
                        .then(() => {
                            if (updateClientCallback) {
                                updateClientCallback(finalAction);
                            }
                        });
                }

                return {
                    status: "success",
                    result
                };
            },
        }),

        mouse_drag_tool: tool({
            description: "Drag the mouse from current position to a specified element",
            parameters: z.object({
                situation_analysis: z.string().describe("Analysis of the current situation"),
                reasoning: z.string().describe("Reasoning behind the drag action"),
                box_id: z.number().describe("The ID of the box to drag to"),
                action_description: z.string().describe("Description of what the drag will do, formatted with markdown"),
                save_information: z.boolean().describe("Save the information on the screen in the memory")
            }),
            execute: async ({ box_id, reasoning, action_description, save_information }) => {
                console.log(`Executing mouse drag to box_id: ${box_id}`);

                let coordinates = getBoxCoordinates(
                    box_id,
                    parsedContentList,
                    imageWidth,
                    imageHeight
                );

                // Create initial action object
                const initialAction = {
                    text: action_description,
                    start_time: Date.now(),
                    end_time: null,
                    action_type: "left_click_drag",
                    box_id,
                    value: null,
                    metadata: {
                        screenshot_base64: `data:image/png;base64,${currentCapture.screenshotData.base64Image}`,
                        parsed_screenshot_base64: `data:image/png;base64,${currentCapture.parsedData.som_image_base64}`,
                        actionData: {
                            reasoning,
                            action_description,
                            action: "left_click_drag",
                            box_id,
                            save_information
                        }
                    }
                };

                // Send initial update to client
                if (updateClientCallback) {
                    updateClientCallback(initialAction);
                }

                // Execute the command
                const pyCommand = convertActionToPyAutoGUI(
                    "left_click_drag",
                    coordinates,
                    null
                );

                const result = await sendCommandToVM(pyCommand);

                // Update action with results and end_time
                const finalAction = {
                    ...initialAction,
                    end_time: Date.now(),
                    metadata: {
                        ...initialAction.metadata,
                        toolResult: result
                    }
                };

                // Send final update to client
                if (updateClientCallback) {
                    updateClientCallback(finalAction);
                }

                // Fetch and save screen recording if job ID is available
                if (result.screen_recording_job_id) {
                    fetchAndSaveScreenRecording(result.screen_recording_job_id, finalAction)
                        .catch(console.error)
                        .then(() => {
                            if (updateClientCallback) {
                                updateClientCallback(finalAction);
                            }
                        });
                }

                return {
                    status: "success",
                    result
                };
            },
        }),

        // 2. KEYBOARD INTERACTION TOOLS

        keyboard_type_tool: tool({
            description: "Type text into the focused element or at the specified element",
            parameters: z.object({
                situation_analysis: z.string().describe("Analysis of the current situation"),
                reasoning: z.string().describe("Reasoning behind the text input"),
                text: z.string().describe("The text to type"),
                press_enter: z.boolean().describe("Whether to press Enter after typing (default: true)"),
                box_id: z.number().describe("The ID of a box to click before typing (0 if not needed)"),
                action_description: z.string().describe("Description of what typing will do, formatted with markdown"),
                save_information: z.boolean().describe("Save the information on the screen in the memory")
            }),
            execute: async ({ text, press_enter, box_id, reasoning, action_description, save_information }) => {
                console.log(`Executing keyboard type: "${text}" with press_enter=${press_enter}`);

                let coordinates = null;
                if (box_id !== null && box_id !== undefined) {
                    coordinates = getBoxCoordinates(
                        box_id,
                        parsedContentList,
                        imageWidth,
                        imageHeight
                    );
                }

                // Determine the action type based on press_enter
                const action_type = press_enter ? "type" : "type_no_enter";

                // Create initial action object
                const initialAction = {
                    text: action_description,
                    start_time: Date.now(),
                    end_time: null,
                    action_type,
                    box_id,
                    value: text,
                    metadata: {
                        screenshot_base64: `data:image/png;base64,${currentCapture.screenshotData.base64Image}`,
                        parsed_screenshot_base64: `data:image/png;base64,${currentCapture.parsedData.som_image_base64}`,
                        actionData: {
                            reasoning,
                            action_description,
                            action: action_type,
                            box_id,
                            value: text,
                            save_information
                        }
                    }
                };

                // Send initial update to client
                if (updateClientCallback) {
                    updateClientCallback(initialAction);
                }

                // Execute the command
                const pyCommand = convertActionToPyAutoGUI(
                    action_type,
                    coordinates,
                    text
                );

                const result = await sendCommandToVM(pyCommand);

                // Add delay after typing
                await new Promise((resolve) => setTimeout(resolve, CONFIG.DELAYS.ACTION_MS));

                // Update action with results and end_time
                const finalAction = {
                    ...initialAction,
                    end_time: Date.now(),
                    metadata: {
                        ...initialAction.metadata,
                        toolResult: result
                    }
                };

                // Send final update to client
                if (updateClientCallback) {
                    updateClientCallback(finalAction);
                }

                // Fetch and save screen recording if job ID is available
                if (result.screen_recording_job_id) {
                    fetchAndSaveScreenRecording(result.screen_recording_job_id, finalAction)
                        .catch(console.error)
                        .then(() => {
                            if (updateClientCallback) {
                                updateClientCallback(finalAction);
                            }
                        });
                }

                return {
                    status: "success",
                    result
                };
            },
        }),

        keyboard_press_tool: tool({
            description: "Press a key or key combination",
            parameters: z.object({
                situation_analysis: z.string().describe("Analysis of the current situation"),
                reasoning: z.string().describe("Reasoning behind the key press"),
                key: z.string().describe("The key or key combination to press (e.g., 'enter', 'ctrl+c', 'alt+tab')"),
                action_description: z.string().describe("Description of what the key press will do, formatted with markdown"),
                save_information: z.boolean().describe("Save the information on the screen in the memory")
            }),
            execute: async ({ key, reasoning, action_description, save_information }) => {
                console.log(`Executing keyboard press: "${key}"`);

                // Create initial action object
                const initialAction = {
                    text: action_description,
                    start_time: Date.now(),
                    end_time: null,
                    action_type: "key",
                    box_id: null,
                    value: key,
                    metadata: {
                        screenshot_base64: `data:image/png;base64,${currentCapture.screenshotData.base64Image}`,
                        parsed_screenshot_base64: `data:image/png;base64,${currentCapture.parsedData.som_image_base64}`,
                        actionData: {
                            reasoning,
                            action_description,
                            action: "key",
                            value: key,
                            save_information
                        }
                    }
                };

                // Send initial update to client
                if (updateClientCallback) {
                    updateClientCallback(initialAction);
                }

                // Execute the command
                const pyCommand = convertActionToPyAutoGUI(
                    "key",
                    null,
                    key
                );

                const result = await sendCommandToVM(pyCommand);

                // Add delay after key press
                await new Promise((resolve) => setTimeout(resolve, CONFIG.DELAYS.ACTION_MS));

                // Update action with results and end_time
                const finalAction = {
                    ...initialAction,
                    end_time: Date.now(),
                    metadata: {
                        ...initialAction.metadata,
                        toolResult: result
                    }
                };

                // Send final update to client
                if (updateClientCallback) {
                    updateClientCallback(finalAction);
                }

                // Fetch and save screen recording if job ID is available
                if (result.screen_recording_job_id) {
                    fetchAndSaveScreenRecording(result.screen_recording_job_id, finalAction)
                        .catch(console.error)
                        .then(() => {
                            if (updateClientCallback) {
                                updateClientCallback(finalAction);
                            }
                        });
                }

                return {
                    status: "success",
                    result
                };
            },
        }),

        // 3. SCROLLING TOOLS

        scroll_tool: tool({
            description: "Scroll the page up or down",
            parameters: z.object({
                situation_analysis: z.string().describe("Analysis of the current situation"),
                reasoning: z.string().describe("Reasoning behind the scroll action"),
                direction: z.enum(["up", "down"]).describe("The direction to scroll"),
                action_description: z.string().describe("Description of what scrolling will do, formatted with markdown"),
                save_information: z.boolean().describe("Save the information on the screen in the memory")
            }),
            execute: async ({ direction, reasoning, action_description, save_information }) => {
                console.log(`Executing scroll ${direction}`);

                // Map direction to action
                const action_type = direction === "up" ? "scroll_up" : "scroll_down";

                // Create initial action object
                const initialAction = {
                    text: action_description,
                    start_time: Date.now(),
                    end_time: null,
                    action_type,
                    box_id: null,
                    value: null,
                    metadata: {
                        screenshot_base64: `data:image/png;base64,${currentCapture.screenshotData.base64Image}`,
                        parsed_screenshot_base64: `data:image/png;base64,${currentCapture.parsedData.som_image_base64}`,
                        actionData: {
                            reasoning,
                            action_description,
                            action: action_type,
                            save_information
                        }
                    }
                };

                // Send initial update to client
                if (updateClientCallback) {
                    updateClientCallback(initialAction);
                }

                // Execute the command
                const pyCommand = convertActionToPyAutoGUI(
                    action_type,
                    null,
                    null
                );

                const result = await sendCommandToVM(pyCommand);

                // Add delay after scrolling
                await new Promise((resolve) => setTimeout(resolve, CONFIG.DELAYS.SCROLL_WAIT_MS));

                // Update action with results and end_time
                const finalAction = {
                    ...initialAction,
                    end_time: Date.now(),
                    metadata: {
                        ...initialAction.metadata,
                        toolResult: result
                    }
                };

                // Send final update to client
                if (updateClientCallback) {
                    updateClientCallback(finalAction);
                }

                // Fetch and save screen recording if job ID is available
                if (result.screen_recording_job_id) {
                    fetchAndSaveScreenRecording(result.screen_recording_job_id, finalAction)
                        .catch(console.error)
                        .then(() => {
                            if (updateClientCallback) {
                                updateClientCallback(finalAction);
                            }
                        });
                }

                return {
                    status: "success",
                    result
                };
            },
        }),

        // scroll_until_found_tool: tool({
        //     description: "Scroll the page until specified text is found",
        //     parameters: z.object({
        //         situation_analysis: z.string().describe("Analysis of the current situation"),
        //         reasoning: z.string().describe("Reasoning behind searching for this text"),
        //         direction: z.enum(["up", "down"]).describe("The direction to scroll"),
        //         search_text: z.string().describe("The text to search for while scrolling"),
        //         action_description: z.string().describe("Description of what this search will do, formatted with markdown"),
        //         save_information: z.boolean().describe("Save the information on the screen in the memory")
        //     }),
        //     execute: async ({ direction, search_text, reasoning, action_description, save_information }) => {
        //         console.log(`Executing scroll ${direction} until text "${search_text}" is found`);

        //         // Map direction to action
        //         const action_type = direction === "up"
        //             ? "scroll_up_until_text_found"
        //             : "scroll_down_until_text_found";

        //         // Create initial action object
        //         const initialAction = {
        //             text: action_description,
        //             start_time: Date.now(),
        //             end_time: null,
        //             action_type,
        //             box_id: null,
        //             value: search_text,
        //             metadata: {
        //                 screenshot_base64: `data:image/png;base64,${currentCapture.screenshotData.base64Image}`,
        //                 parsed_screenshot_base64: `data:image/png;base64,${currentCapture.parsedData.som_image_base64}`,
        //                 actionData: {
        //                     reasoning,
        //                     action_description,
        //                     action: action_type,
        //                     value: search_text,
        //                     save_information
        //                 }
        //             }
        //         };

        //         // Send initial update to client
        //         if (updateClientCallback) {
        //             updateClientCallback(initialAction);
        //         }

        //         const searchText = CONFIG.SCROLL.CASE_SENSITIVE ? search_text : search_text.toLowerCase();
        //         let attempts = 0;
        //         let textFound = false;

        //         while (attempts < CONFIG.SCROLL.MAX_ATTEMPTS && !textFound) {
        //             // Execute a scroll
        //             const pyCommand = convertActionToPyAutoGUI(action_type, null, search_text);
        //             console.log("Command to send to VM:", pyCommand);
        //             const result = await sendCommandToVM(pyCommand);
        //             console.log(`Scroll ${attempts + 1}/${CONFIG.SCROLL.MAX_ATTEMPTS} executed:`, result);

        //             // Wait a bit after scrolling for stabilization
        //             await new Promise((resolve) => setTimeout(resolve, CONFIG.DELAYS.SCROLL_WAIT_MS));

        //             // Capture and parse the screen after scrolling
        //             const newCapture = await captureAndParseScreenshot();

        //             // Check if the text is present in the parsed content
        //             textFound = newCapture.parsedData.parsed_content_list.some(item => {
        //                 const itemText = CONFIG.SCROLL.CASE_SENSITIVE ? item.content : item.content.toLowerCase();
        //                 return itemText.includes(searchText);
        //             });

        //             if (textFound) {
        //                 console.log(`Text "${searchText}" found after ${attempts + 1} scrolls.`);
        //             } else {
        //                 console.log(`Text "${searchText}" not found after ${attempts + 1} scrolls. Continuing...`);
        //                 attempts++;
        //             }
        //         }

        //         if (!textFound) {
        //             console.warn(`Text "${searchText}" not found after ${CONFIG.SCROLL.MAX_ATTEMPTS} attempts.`);
        //         }

        //         const result = { textFound, attempts, searchText };

        //         // Update action with results and end_time
        //         const finalAction = {
        //             ...initialAction,
        //             end_time: Date.now(),
        //             metadata: {
        //                 ...initialAction.metadata,
        //                 toolResult: result
        //             }
        //         };

        //         // Send final update to client
        //         if (updateClientCallback) {
        //             updateClientCallback(finalAction);
        //         }

        //         return {
        //             status: "success",
        //             result
        //         };
        //     },
        // }),
    };
}

async function getAIResponse(messages, currentCapture = null, isFinalResponse = false, updateClientCallback = null) {
    const maxRetries = 3;
    let retryCount = 0;

    const { model, modelName, providerOptions } = getAIModel(CONFIG.AI_MODEL);

    while (retryCount < maxRetries) {
        try {
            if (isFinalResponse) {
                // For the final response, generate text without tools
                const { text, usage } = await generateText({
                    model,
                    messages: [
                        {
                            role: "system",
                            content: BASE_PROMPT,
                        },
                        ...messages,
                        {
                            role: "user",
                            content: "<system_message>Your task is completed. You can now speak with the user, the user do not see the tools you have used and the results of the actions you have performed. You need to provide a final answer to the initial user message.</system_message>"
                        }
                    ],
                    temperature: CONFIG.TEMPERATURE,
                    providerOptions: providerOptions ? providerOptions : undefined
                });

                const priceDetails = calculateRequestPrice(usage, modelName);
                console.log("Usage and price of the final request:", {
                    ...priceDetails,
                    details: `Prompt: $${formatPrice(priceDetails.promptPrice)} | Completion: $${formatPrice(
                        priceDetails.completionPrice
                    )} | Total: $${formatPrice(priceDetails.totalPrice)}`,
                });

                return { text, usage };
            } else {
                // For actions, use tools
                const tools = currentCapture ? getAITools(currentCapture, updateClientCallback) : {};

                const response = await generateText({
                    model,
                    messages: [
                        {
                            role: "system",
                            content: BASE_PROMPT,
                        },
                        ...messages,
                    ],
                    tools: tools,
                    toolChoice: 'required', // Force tool usage
                    temperature: CONFIG.TEMPERATURE,
                    providerOptions: providerOptions ? providerOptions : undefined
                });

                const { text, toolCalls, toolResults, usage } = response;

                const priceDetails = calculateRequestPrice(usage, modelName);
                console.log("Usage and price of the action request:", {
                    ...priceDetails,
                    details: `Prompt: $${formatPrice(priceDetails.promptPrice)} | Completion: $${formatPrice(
                        priceDetails.completionPrice
                    )} | Total: $${formatPrice(priceDetails.totalPrice)}`,
                });

                return {
                    text,
                    toolCalls,
                    toolResults,
                    usage,
                    response
                };
            }
        } catch (error) {
            // Check for quota errors
            const isQuotaError =
                error.statusCode === 429 ||
                (error.data?.error?.status === "RESOURCE_EXHAUSTED") ||
                error.message?.includes("Resource has been exhausted");

            if (isQuotaError) {
                retryCount++;
                if (retryCount < maxRetries) {
                    console.log(`Quota exceeded. Waiting 60 seconds before retrying (attempt ${retryCount}/${maxRetries})...`);
                    await new Promise(resolve => setTimeout(resolve, 60000)); // 60 seconds
                    continue;
                }
            }

            // If not a quota error or retries exceeded
            console.error("Error generating text via AI:", error);
            throw error;
        }
    }
}

// Utility function to build message contents
async function buildMessageContents(userInput, currentCapture) {
    const messageContents = [];

    // Builds the screen information string
    let screen_info = "";
    currentCapture.parsedData.parsed_content_list.forEach((element, idx) => {
        if (element['type'] == 'text') {
            screen_info += `ID: ${idx}, Text: ${element["content"]}\n`;
        } else if (element['type'] == 'icon') {
            screen_info += `ID: ${idx}, Icon: ${element["content"]}\n`;
        }
    });

    // Adds screenshots
    if (CONFIG.SEND_SCREENSHOT) {
        if (CONFIG.CONVERT_SCREENSHOT_TO_DESCRIPTION) {
            const screenshotDescription = await getScreenshotDescription(currentCapture.screenshotData.base64Image);
            messageContents.push({
                type: "text",
                text: `<screenshot_description>${screenshotDescription}</screenshot_description>`
            });
        } else {
            messageContents.push({
                type: "image",
                image: `data:image/png;base64,${currentCapture.screenshotData.base64Image}`
            });
        }
    }

    // Adds parsed screenshots
    if (CONFIG.SEND_PARSED_SCREENSHOT) {
        if (CONFIG.CONVERT_SCREENSHOT_TO_DESCRIPTION) {
            const parsedScreenshotDescription = await getScreenshotDescription(currentCapture.parsedData.som_image_base64);
            messageContents.push({
                type: "text",
                text: `<screenshot_description>${parsedScreenshotDescription}</screenshot_description>`
            });
        } else {
            messageContents.push({
                type: "image",
                image: `data:image/png;base64,${currentCapture.parsedData.som_image_base64}`
            });
        }
    }

    // Adds screen information
    messageContents.push({
        type: "text",
        text: `<screen_info>\n${screen_info}\n</screen_info>`,
    });

    // Adds user interaction if provided
    if (userInput) {
        messageContents.push({
            type: "text",
            text: `<user_interaction>${userInput}</user_interaction>`,
        });
    }

    // Adds fallback mode information if necessary
    if (isInFallbackMode) {
        messageContents.push({
            type: "text",
            text: `<information>The windows computer is not controllable right now. Only the wait_tool is available. This means the windows computer is not ready yet (Restarting, updating, etc.)</information>`,
        });
    }

    return messageContents;
}

function getBoxCoordinates(boxId, parsedContentList, imageWidth, imageHeight) {
    // Search for the box by its ID (index in the list)
    const box = parsedContentList.find((_, index) => index === boxId);
    if (!box) {
        throw new Error(
            `Cannot find box ID ${boxId} in a list of length ${parsedContentList.length}.`
        );
    }

    // bbox contains [x1, y1, x2, y2] as percentages of the image
    // We calculate the coordinates of the center of the box in pixels
    const x = Math.round(
        box.bbox[0] * imageWidth + ((box.bbox[2] - box.bbox[0]) * imageWidth) / 2
    );
    const y = Math.round(
        box.bbox[1] * imageHeight + ((box.bbox[3] - box.bbox[1]) * imageHeight) / 2
    );

    return { x, y };
}

function convertActionToPyAutoGUI(action, coordinates, value = null) {
    const baseCmd = "import pyautogui; import time; pyautogui.FAILSAFE=False;";

    const escapeString = (str) => {
        if (!str) return str;
        return str
            .replace(/\\/g, "\\\\")
            .replace(/'/g, "\\'")
            .replace(/"/g, '\\"')
            .split("")
            .map((char) => {
                const code = char.charCodeAt(0);
                return code > 127 ? `\\u${code.toString(16).padStart(4, "0")}` : char;
            })
            .join("");
    };

    switch (action.toLowerCase()) {
        case "type": {
            if (!value) {
                throw new Error("The 'type' action requires a 'value'.");
            }
            const escapedValue = escapeString(value);
            if (!coordinates) {
                return (
                    `${baseCmd} pyautogui.write(u"${escapedValue}",interval=${CONFIG.DELAYS.TYPING_MS / 1000}); pyautogui.press('enter')`
                );
            }
            return (
                `${baseCmd} pyautogui.click(x=${coordinates.x}, y=${coordinates.y}); ` +
                `pyautogui.write(u"${escapedValue}",interval=${CONFIG.DELAYS.TYPING_MS / 1000}); ` +
                "pyautogui.press('enter')"
            );
        }
        case "type_no_enter": {
            if (!value) {
                throw new Error("The 'type_no_enter' action requires a 'value'.");
            }
            const escapedValue = escapeString(value);
            if (!coordinates) {
                return (
                    `${baseCmd} pyautogui.write(u"${escapedValue}",interval=${CONFIG.DELAYS.TYPING_MS / 1000})`
                );
            }
            return (
                `${baseCmd} pyautogui.click(x=${coordinates.x}, y=${coordinates.y}); ` +
                `pyautogui.write(u"${escapedValue}",interval=${CONFIG.DELAYS.TYPING_MS / 1000})`
            );
        }
        case "key": {
            if (!value) {
                throw new Error("The 'key' action requires a 'value' (key or combination).");
            }
            const keys = value.split("+").map((k) => k.trim().toLowerCase());
            const keyDown = keys.map((k) => `pyautogui.keyDown('${k}')`).join("; ");
            const keyUp = keys.reverse().map((k) => `pyautogui.keyUp('${k}')`).join("; ");
            return `${baseCmd} ${keyDown}; ${keyUp}`;
        }
        case "left_click": {
            if (!coordinates) {
                throw new Error("The 'left_click' action requires a 'box_id'.");
            }
            return `${baseCmd} pyautogui.click(x=${coordinates.x}, y=${coordinates.y})`;
        }
        case "right_click": {
            if (!coordinates) {
                throw new Error("The 'right_click' action requires a 'box_id'.");
            }
            return `${baseCmd} pyautogui.rightClick(x=${coordinates.x}, y=${coordinates.y})`;
        }
        case "double_click": {
            if (!coordinates) {
                throw new Error("The 'double_click' action requires a 'box_id'.");
            }
            return `${baseCmd} pyautogui.doubleClick(x=${coordinates.x}, y=${coordinates.y})`;
        }
        case "middle_click": {
            if (!coordinates) {
                throw new Error("The 'middle_click' action requires a 'box_id'.");
            }
            return `${baseCmd} pyautogui.middleClick(x=${coordinates.x}, y=${coordinates.y})`;
        }
        case "hover": {
            if (!coordinates) {
                throw new Error("The 'hover' action requires a 'box_id'.");
            }
            // For hover, we keep a slight delay for smooth movement
            return `${baseCmd} pyautogui.moveTo(x=${coordinates.x}, y=${coordinates.y}, duration=0.1)`;
        }
        case "scroll_up": {
            return `${baseCmd} pyautogui.scroll(${CONFIG.SCROLL.AMOUNT});`;
        }
        case "scroll_down": {
            return `${baseCmd} pyautogui.scroll(-${CONFIG.SCROLL.AMOUNT});`;
        }
        case "scroll_down_until_text_found": {
            if (!value) {
                throw new Error("The 'scroll_down_until_text_found' action requires a 'value' (text to search for).");
            }
            return `${baseCmd} pyautogui.scroll(-${CONFIG.SCROLL.AMOUNT});`;
        }
        case "scroll_up_until_text_found": {
            if (!value) {
                throw new Error("The 'scroll_up_until_text_found' action requires a 'value' (text to search for).");
            }
            return `${baseCmd} pyautogui.scroll(${CONFIG.SCROLL.AMOUNT});`;
        }
        case "left_click_drag": {
            if (!coordinates) {
                throw new Error("The 'left_click_drag' action requires a 'box_id'.");
            }
            // For drag, we must specify the start and end coordinates
            // Since we only have the destination coordinates, we use the current position as the start
            return `${baseCmd} pyautogui.dragTo(x=${coordinates.x}, y=${coordinates.y}, duration=${CONFIG.DRAG_DURATION_SECONDS})`;
        }
        default: {
            throw new Error(`Unsupported action: ${action}`);
        }
    }
}

async function sendPowershellCommand(command) {
    try {
        // 1. Send the PowerShell command
        const response = await axios.post(`${CONFIG.VNC_SERVER_URL}/execute_powershell`, {
            command: command,
        });

        // Check if the request was successful
        if (response.data.status !== 'success' || !response.data.job_id) {
            console.error("Error executing the PowerShell command:", response.data);
            return {
                output: "",
                error: "Error executing the PowerShell command",
                returncode: 1
            };
        }

        // 2. Retrieve the job_id
        const jobId = response.data.job_id;
        console.log(`PowerShell command started with job_id: ${jobId}`);

        // 3. Check job status every second for a maximum of 30 seconds
        const MAX_ATTEMPTS = 30;
        const POLL_INTERVAL = 1000; // 1 second
        let jobStatus;
        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
            // Wait for the polling interval
            await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));

            // Retrieve the job status
            const statusResponse = await axios.get(`${CONFIG.VNC_SERVER_URL}/powershell_job/${jobId}`);
            jobStatus = statusResponse.data;

            // If the job is finished, return the results
            if (jobStatus.status === 'completed' || jobStatus.status === 'error') {
                console.log(`PowerShell job ${jobId} finished with status: ${jobStatus.status}`);
                return {
                    output: jobStatus.output || "",
                    error: jobStatus.error || null,
                    returncode: jobStatus.returncode || 0,
                    screen_recording_job_id: null // No video for PowerShell commands
                };
            }

            console.log(`PowerShell job ${jobId} in progress (attempt ${attempt + 1}/${MAX_ATTEMPTS})...`);
        }

        // 4. If the job is not finished after 30 seconds, return the job_id and status
        console.log(`PowerShell job ${jobId} not finished after ${MAX_ATTEMPTS} seconds, returning partial status`);
        return {
            output: `Command running (job_id: ${jobId})...`,
            error: null,
            returncode: null,
            job_id: jobId,
            status: 'running',
            is_long_running: true, // Indicate that it's a long-running task
            current_output: jobStatus.output || "",
            current_error: jobStatus.error || ""
        };
    } catch (error) {
        console.error("Error calling /execute_powershell:", error);
        return {
            output: "",
            error: `Error executing the PowerShell command: ${error.message}`,
            returncode: 1
        };
    }
}

async function sendCommandToVM(pythonCode) {
    try {
        const response = await axios.post(`${CONFIG.VNC_SERVER_URL}/execute`, {
            command: ["python", "-c", pythonCode],
        });
        return response.data;
    } catch (error) {
        console.error("Error sending command to VM:", error);
        return {};
    }
}

// Function to convert a screenshot to description with cache
async function getScreenshotDescription(base64Image) {
    // Check if the description is already cached
    if (screenshotDescriptionCache.has(base64Image)) {
        return screenshotDescriptionCache.get(base64Image);
    }

    // If not cached, convert the screenshot
    const description = await convertScreenshotToDescription(base64Image);

    // Cache the description
    screenshotDescriptionCache.set(base64Image, description);

    // Limit cache size (keep the last 100 descriptions)
    if (screenshotDescriptionCache.size > 100) {
        const firstKey = screenshotDescriptionCache.keys().next().value;
        screenshotDescriptionCache.delete(firstKey);
    }

    return description;
}

async function captureAndParseScreenshot() {
    const MAX_RETRIES = 5;  // Maximum number of retries
    const RETRY_DELAY = 2000;  // Delay between retries in milliseconds

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            isInFallbackMode = false;
            const screenshotData = await getScreenshotFromVNC();
            console.log(`→ Screenshot successfully retrieved (attempt ${attempt}/${MAX_RETRIES}).`);

            try {
                const parsedData = await parseScreenshot(screenshotData.base64Image);
                console.log("→ Image successfully parsed.");
                return {
                    screenshotData,
                    parsedData,
                };
            } catch (parseError) {
                if (parseError?.response?.status === 500) {
                    console.log(`→ 500 error during parsing (attempt ${attempt}/${MAX_RETRIES}). The screen might be black or have no visible elements.`);
                    if (attempt === MAX_RETRIES) {
                        throw new Error(`Parsing failed after ${MAX_RETRIES} attempts. The screen might be black or have no visible elements.`);
                    }
                    // Wait before next attempt
                    await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
                    continue;
                }
                // If it's not a 500 error, throw it immediately
                throw parseError;
            }
        } catch (error) {
            if (attempt === MAX_RETRIES) {
                throw error;
            }
            console.log(`→ Error capturing screenshot (attempt ${attempt}/${MAX_RETRIES}). Retrying in ${RETRY_DELAY / 1000} seconds.`);
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
        }
    }
}

/**
 * Cleans up history to avoid sending too many images to the API
 * (only a certain number of images are kept).
 */
function cleanupOldMessageImages(messages) {
    let cleanedMessages = [...messages];

    const userImagesIndices = cleanedMessages.reduce((acc, msg, idx) => {
        if (msg.role === "user" && Array.isArray(msg.content)) {
            const hasImage = msg.content.some((item) => item.type === "image");
            if (hasImage) acc.push(idx);
        }
        return acc;
    }, []);

    // Find all indices of messages containing screen_info
    const screenInfoIndices = cleanedMessages.reduce((acc, msg, idx) => {
        if (msg.role === "user" && Array.isArray(msg.content)) {
            const hasScreenInfo = msg.content.some(
                (item) => item.type === "text" && item.text.startsWith("<screen_info>")
            );
            if (hasScreenInfo) acc.push(idx);
        }
        return acc;
    }, []);

    // Find all indices of assistant messages
    const assistantIndices = cleanedMessages.reduce((acc, msg, idx) => {
        if (msg.role === "assistant") acc.push(idx);
        return acc;
    }, []);

    // Keep only the last N screen_info
    const screenInfoToKeep = screenInfoIndices.slice(-CONFIG.MAX_SCREEN_INFO_IN_HISTORY);

    // Keep only the last N assistant messages for situation_analysis
    const assistantToKeep = assistantIndices.slice(-CONFIG.MAX_SITUATION_ANALYSIS_IN_HISTORY);

    cleanedMessages.forEach((message, index) => {
        if (message.role === "user" && Array.isArray(message.content)) {
            if (!screenInfoToKeep.includes(index)) {
                message.content = message.content.filter(
                    (item) => item.type !== "text" || !item.text.startsWith("<screen_info>")
                );
            }
        }
    });

    if (userImagesIndices.length > CONFIG.MAX_IMAGES_IN_HISTORY) {
        const indicesToClean = userImagesIndices.slice(0, -CONFIG.MAX_IMAGES_IN_HISTORY);
        indicesToClean.forEach((index) => {
            const message = cleanedMessages[index];
            message.content = message.content.filter((item) => item.type !== "image");
        });
    }

    // Check if there are user messages with empty content, if so delete them
    cleanedMessages = cleanedMessages.filter((message) => {
        if (message.role === "user" && message.content.length === 0) {
            return false;
        }
        return true;
    });

    return cleanedMessages;
}

// Function to fetch and save the video asynchronously
async function fetchAndSaveScreenRecording(jobId, currentAction) {
    try {
        const maxAttempts = 30; // Maximum 30 attempts
        const delayBetweenAttempts = 1000; // 1 second between each attempt

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const response = await axios.get(`http://localhost:5000/job/${jobId}`, { timeout: 10000 });
            const jobData = response.data;

            if (jobData.status === "completed" && jobData.screen_recording) {
                currentAction.metadata.screen_recording_base64 = `data:video/mp4;base64,${jobData.screen_recording}`;
                break;
            } else if (jobData.status === "failed") {
                console.error(`Failed to retrieve video for job ${jobId}`);
                break;
            }

            // Wait before the next attempt
            await new Promise(resolve => setTimeout(resolve, delayBetweenAttempts));
        }
    } catch (error) {
        console.error(`Error fetching/saving video (job ${jobId}):`, error.message);
    }
}

// -- New SSE endpoint -----------------------------------------------------
//
// We use GET /send_message?message=xxxx
// to simplify the use of SSE (EventSource) on the client side.
//
app.get("/send_message", async (req, res) => {
    // SSE Configuration
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    // Flush initial headers
    res.flushHeaders();

    const userInput = req.query.message;
    if (!userInput) {
        res.write(`event: error\ndata: ${JSON.stringify({ error: "Missing ?message=..." })}\n\n`);
        return res.end();
    }

    // Create request tracking object
    const requestId = uuidv4();
    const requestTracker = {
        stopRequested: false,
        res: res,
        startTime: Date.now()
    };
    activeRequests.set(requestId, requestTracker);

    // Reset consecutive wait counter at the start of a new interaction
    consecutiveWaitCount = 0;

    try {
        console.log("Starting automation process...");
        // Resets cost tracking for this session
        totalRequestPrice = {
            promptPrice: 0,
            completionPrice: 0,
            totalPrice: 0,
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
        };

        // 1) Create a user message (with an ID)
        const userMessageId = uuidv4();
        const userMessage = {
            id: userMessageId,
            sender: "user",
            text: userInput,
            requestId: requestId
        };
        clientHistory.push(userMessage);
        res.write(`event: message\ndata: ${JSON.stringify(userMessage)}\n\n`);

        // 2) Prepare an assistant message
        const assistantMessageId = uuidv4();
        const assistantMessage = {
            id: assistantMessageId,
            sender: "assistant",
            text: "",
            is_generating: true,
            requestId: requestId,
            actions: {
                start_time: Date.now(),
                end_time: null,
                list_of_actions: [],
            },
        };
        res.write(`event: message\ndata: ${JSON.stringify(assistantMessage)}\n\n`);
        clientHistory.push(assistantMessage);
        saveClientHistory();

        // 3) Initial capture and parsing
        let currentCapture = await captureAndParseScreenshot();

        // 4) Building messages for the AI
        let messages = [...globalMessages]; // Start with the existing history
        messages.push({
            role: "user",
            content: await buildMessageContents(userInput, currentCapture)
        });

        console.log("Messages:", messages);
        isTaskDone = false;
        isWaitingForUserResponse = false;

        // Callback function to update the client in real time
        const updateClientWithAction = (action) => {
            if (!requestTracker.stopRequested && requestTracker.res) {
                // Add the action to the list or update if it already exists
                const actionIndex = assistantMessage.actions.list_of_actions.findIndex(
                    a => a.start_time === action.start_time && a.action_type === action.action_type
                );

                if (actionIndex === -1) {
                    // New action
                    assistantMessage.actions.list_of_actions.push(action);
                } else {
                    // Update an existing action
                    assistantMessage.actions.list_of_actions[actionIndex] = action;
                }

                // Send the update to the client
                requestTracker.res.write(`event: message\ndata: ${JSON.stringify(assistantMessage)}\n\n`);
                saveClientHistory();
            }
        };

        // 5) AI action loop
        while (!isTaskDone && !isWaitingForUserResponse) {
            // Clean up message history
            const cleanedMessagesForAPI = cleanupOldMessageImages(messages);

            // Call AI to determine the next action
            const {
                toolCalls,
                toolResults,
                usage,
                response
            } = await getAIResponse(cleanedMessagesForAPI, currentCapture, false, updateClientWithAction);


            // Add response messages to history
            messages.push(...response.response.messages);
            globalMessages = [...messages];
            saveMessagesHistory();


            if (isWaitingForUserResponse) {
                // The task is done, get final response
                console.log("→ Waiting for user response.");
                assistantMessage.actions.end_time = Date.now();
                res.write(`event: message\ndata: ${JSON.stringify(assistantMessage)}\n\n`);
                break;
            }

            if (isTaskDone) {
                // The task is done, get final response
                console.log("→ Task completed by the AI.");
                assistantMessage.actions.end_time = Date.now();
                res.write(`event: message\ndata: ${JSON.stringify(assistantMessage)}\n\n`);

                // Get the final response text
                const { text: finalText, usage: finalUsage } = await getAIResponse(cleanedMessagesForAPI, null, true);
                console.log("Final AI response:", finalText);

                // Update assistant message with final text
                assistantMessage.text = finalText.trim();
                assistantMessage.is_generating = false;
                saveClientHistory();
                res.write(`event: message\ndata: ${JSON.stringify(assistantMessage)}\n\n`);
                break;
            }
            let have_tool_calls = false;
            // Process tool calls
            for (const toolCall of toolCalls) {
                have_tool_calls = true;
                // Track consecutive wait actions
                if (toolCall.name === 'wait_tool') {
                    consecutiveWaitCount++;
                    console.log(`Consecutive wait count: ${consecutiveWaitCount}`);

                    // Add a warning after 3 consecutive waits
                    if (consecutiveWaitCount >= 3 && !isInFallbackMode) {
                        messages.push({
                            role: "user",
                            content: [
                                {
                                    type: "text",
                                    text: `<warning>WARNING: You waited for ${consecutiveWaitCount} times in a row, try again your last action if there is no clear view of loading or any sign of progress. Ignore this warning if you are in an installation process or anything similar.</warning>`,
                                }
                            ],
                        });
                        globalMessages = [...messages];
                        saveMessagesHistory();
                    }
                } else {
                    // Reset counter for non-wait actions
                    consecutiveWaitCount = 0;
                }
            }

            if (!have_tool_calls) {
                // If no tool calls, we need to send a warning to the assistant. It's not allowed to not use any tool.
                messages.push({
                    role: "user",
                    content: [
                        {
                            type: "text",
                            text: `<warning>WARNING: You didn't use any tool, it's not allowed to not use any tool. Please use a tool.</warning>`,
                        }
                    ],
                });
                globalMessages = [...messages];
                saveMessagesHistory();
            }


            // If the task is not done, capture a new screenshot for the next iteration
            if (!isTaskDone) {
                currentCapture = await captureAndParseScreenshot();
                messages.push({
                    role: "user",
                    content: await buildMessageContents(null, currentCapture)
                });
                globalMessages = [...messages];
                saveMessagesHistory();
            }

            // Check if stop was requested
            if (requestTracker.stopRequested) {
                console.log("Stop requested for request", requestId);
                assistantMessage.actions.end_time = Date.now();
                assistantMessage.text = "Request stopped by user.";
                assistantMessage.is_generating = false;
                res.write(`event: message\ndata: ${JSON.stringify(assistantMessage)}\n\n`);
                break;
            }
        }

        // Log cost summary
        console.log("→ Process finished.");
        console.log("\nCost summary:");
        console.log(
            `Total tokens used: ${totalRequestPrice.totalTokens} (${totalRequestPrice.promptTokens} prompt + ${totalRequestPrice.completionTokens} completion)`
        );
        console.log(
            `Total price: $${formatPrice(totalRequestPrice.totalPrice)} (Prompt: $${formatPrice(
                totalRequestPrice.promptPrice
            )} + Completion: $${formatPrice(totalRequestPrice.completionPrice)})`
        );
        console.log(
            `Average price per 1K tokens: $${formatPrice(
                (totalRequestPrice.totalPrice / totalRequestPrice.totalTokens) * 1000
            )}`
        );

        // Clean up the request tracker
        activeRequests.delete(requestId);

        // Close the SSE stream
        res.end();
    } catch (error) {
        // Clean up the request tracker in case of error
        activeRequests.delete(requestId);
        console.error("Global error:", error.message);
        res.write(`event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`);
        res.end();
    }
});

// -- Stop Request Endpoint --------------------------------------------------
app.post("/stop_request", (req, res) => {
    const { messageId } = req.body;

    if (!messageId) {
        return res.status(400).json({ error: "Missing messageId in request body" });
    }

    const request = activeRequests.get(messageId);
    if (!request) {
        return res.status(404).json({ error: "Request not found or already completed" });
    }

    // Set the stopRequested flag to true
    request.stopRequested = true;

    res.json({ status: "success", message: "Stop request received" });
});

// -- Unchanged History Endpoint -------------------------------------------
app.get("/history", (req, res) => {
    try {
        res.json(clientHistory);
    } catch (error) {
        console.error("Error fetching history:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

// -- Settings API Endpoints --------------------------------------------------

// GET /settings - Retrieve current settings
app.get("/settings", (req, res) => {
    try {
        const editableSettings = {};
        EDITABLE_SETTINGS.forEach(key => {
            editableSettings[key] = CONFIG[key];
        });

        res.json(editableSettings);
    } catch (error) {
        console.error("Error retrieving settings:", error);
        res.status(500).json({ error: "Server error retrieving settings" });
    }
});

// POST /settings - Update settings
app.post("/settings", (req, res) => {
    try {
        const newSettings = req.body;

        // Validates and updates only allowed settings
        EDITABLE_SETTINGS.forEach(key => {
            if (newSettings[key] !== undefined) {
                // Type conversion if necessary
                if (typeof CONFIG[key] === 'boolean') {
                    CONFIG[key] = Boolean(newSettings[key]);
                } else if (typeof CONFIG[key] === 'number') {
                    CONFIG[key] = Number(newSettings[key]);
                } else {
                    CONFIG[key] = newSettings[key];
                }
            }
        });

        // Saves updated settings
        saveSettings();

        res.json({ success: true, message: "Settings updated successfully" });
    } catch (error) {
        console.error("Error updating settings:", error);
        res.status(500).json({ error: "Server error updating settings" });
    }
});

// -- Reset Data Endpoint --------------------------------------------------------
app.post("/reset_data", (req, res) => {
    try {
        console.log("Resetting all data...");

        // Reset global variables
        clientHistory = [];
        globalMessages = [];

        // Reset token usage statistics
        totalRequestPrice = {
            promptPrice: 0,
            completionPrice: 0,
            totalPrice: 0,
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
        };

        // Remove history files
        const filesToDelete = [CONFIG.CLIENT_HISTORY_FILE_PATH, CONFIG.MESSAGES_HISTORY_FILE_PATH];

        filesToDelete.forEach(filePath => {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                console.log(`Deleted file: ${filePath}`);
            } else {
                console.log(`File not found: ${filePath}`);
            }
        });

        // Clear the image description cache
        screenshotDescriptionCache.clear();

        console.log("All data has been reset successfully");

        res.json({ success: true, message: "All data has been deleted successfully" });
    } catch (error) {
        console.error("Error deleting data:", error);
        res.status(500).json({ error: "Error deleting data" });
    }
});


app.use(express.static(path.join(__dirname, 'dist')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});


// -- Starting the server -----------------------------------------------------
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    loadClientHistory();
    loadMessagesHistory();
});
process.on('exit', async () => {
    if (browserInstance) {
        await browserInstance.close();
    }
});