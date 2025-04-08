# Open Computer Use - AI Assistant to Control Windows Computer

Open Computer Use is a project that allows an AI model to interact with a Windows environment through a web interface, similar to 'Operator' from ChatGPT but with whole computer control (Not only the browser) and running locally. The system captures the screen, analyzes its content, and can execute actions such as clicking, typing text, scrolling, and running PowerShell commands.


## Demo

Here is a video of the system in action:



https://github.com/user-attachments/assets/8ad10247-ba6f-4414-a48c-0e43451977ad



## System Architecture

The project consists of three main components:

1. **Omnibox** (`/omnibox`) - A Docker container with:
   - A virtualized Windows 11 image
   - A Python server that receives and executes commands on the Windows environment

2. **Omniparser** (`/omniparserserver`) - A Docker container with:
   - Microsoft's Omniparser V2
   - Screen capture analysis service to identify interactive elements

3. **Node.js Server** (`/server`) - A service that:
   - Coordinates interactions between the AI and containers
   - Manages the web user interface
   - Integrates various AI models (Google, OpenAI, Anthropic)

4. **Frontend** (root level) - A React application that:
   - Provides the user interface
   - Built with Vite and Tailwind CSS

## Prerequisites

- Docker and Docker Compose
- Node.js (v14 or higher)
- KVM support for virtualization
- NVIDIA GPU (recommended for Omniparser)
- API keys for AI services (Google, OpenAI, Anthropic)

## Installation

1. Clone this repository:
   ```bash
   git clone https://github.com/Clad3815/open-computer-use
   cd open-computer-use
   ```

2. Download Windows 11 ISO:
   - Visit [Microsoft Evaluation Center](https://www.microsoft.com/en-us/evalcenter/evaluate-windows-11-enterprise)
   - Accept the Terms of Service
   - Download a **Windows 11 Enterprise Evaluation (90-day trial, English, United States)** ISO file (~6GB)
   - Rename the file to `custom.iso` and place it in the directory `omnibox/vm/win11iso/`

3. Create a `.env` file in the `server` folder with your API keys (Only setup the keys for the models you will use):
   ```
   GOOGLE_API_KEY=your_google_api_key
   OPENAI_API_KEY=your_openai_api_key
   ANTHROPIC_API_KEY=your_anthropic_api_key
   ```

4. Build the frontend and start the services:
   ```bash
   # Build the frontend (from the project root) (Only do it first time)
   npm install
   npm run build  # This will build to server/dist
   
   # Start OmniParser
   cd omniparserserver
   docker-compose up -d
   
   # Start Omnibox (Windows)
   cd ../omnibox
   docker-compose up -d
   
   # Start the Node server
   cd ../server
   npm install
   npm start
   ```

5. Access the web interface: `http://localhost:2977`

6. Wait for Windows 11 installation to complete:
   - You can see the progress on the web interface
   - The first boot may take 10-15 minutes
   - The system will automatically install and configure Windows


## Development

If you're working on the frontend, you can run the development server:

```bash
# From the project root
npm run dev
```

This will start the Vite development server on port 7989. Note that you'll still need the backend services running for full functionality.

## Usage

1. Open the web interface at `http://localhost:2977`
2. Enter a task to accomplish, for example:
   - "Open Notepad and type 'Hello World'"
   - "Search for 'tech news' on Google"
   - "Install Firefox with Chocolatey"

The AI will analyze the request, observe the Windows screen, and perform the necessary actions. All actions are visible in real-time in the interface.

## Main Features

- **Mouse interactions**: Click, double-click, right-click, hover, drag-and-drop
- **Keyboard interactions**: Text typing, keyboard shortcuts
- **Scrolling and searching**: Vertical scrolling, text search in the page
- **PowerShell commands**: Execution of system commands
- **File operations**: Reading, writing, and searching in files
- **Fallback mode**: Management of situations where the Windows computer is not controllable

## Available API

The server exposes several endpoints, including:

- `GET /send_message?message=xxx`: Sends a command to the AI (SSE format)
- `GET /history`: Retrieves interaction history
- `GET /settings`: Retrieves current settings
- `POST /settings`: Updates settings
- `POST /reset_data`: Resets all data

## Troubleshooting

- **Windows image doesn't start**: Verify that your system supports KVM and that permissions are correct.
- **Omniparser fails**: Make sure NVIDIA drivers are correctly installed if you're using a GPU.
- **AI actions are incorrect**: Adjust the prompt in `./prompts/base.txt` to improve understanding.
- **Windows installation fails**: Make sure you've downloaded the correct ISO and placed it in the right directory.
- **Frontend not loading**: Check that you've built the frontend with `npm run build` before starting the server.

## Current Limitations

- The system works best with standard Windows applications and websites.
- Some applications with complex interfaces may be difficult to analyze.

## Project Structure

```
omnibox/              # Root directory
├── omnibox/          # Windows container files
├── omniparserserver/ # Omniparser container files
├── server/           # Node.js backend server
│   ├── dist/         # Built frontend (after npm run build)
│   ├── .env          # Environment variables with API keys
│   └── server.js     # Main server file
├── public/           # Frontend public assets
├── src/              # Frontend source files
├── package.json      # Frontend dependencies
└── README.md         # This file
```

## License

This project is distributed under the MIT license. See the LICENSE file for more details.


## Acknowledgments

- Microsoft for [Omniparser V2](https://github.com/microsoft/OmniParser)

---

For any questions or suggestions, please open an issue on this GitHub repository.
