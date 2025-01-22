import { App, Plugin, PluginSettingTab, Setting, TFile, WorkspaceLeaf, moment, requestUrl } from 'obsidian';
import { ClaudeChatSettings, DEFAULT_SETTINGS, ClaudeChatSettingTab } from './settings';
import { ChatView, CHAT_VIEW_TYPE } from './ChatView';

export default class ClaudeChatPlugin extends Plugin {
    settings: ClaudeChatSettings;

    async onload() {
        console.log('Loading Claude Chat plugin...');
        await this.loadSettings();
        console.log('Settings loaded:', this.settings);
        
        // Ensure conversation folder exists
        if (!(await this.app.vault.adapter.exists(this.settings.conversationFolder))) {
            console.log('Creating conversation folder:', this.settings.conversationFolder);
            await this.app.vault.createFolder(this.settings.conversationFolder);
        }

        // Register view
        this.registerView(CHAT_VIEW_TYPE, (leaf) => new ChatView(leaf, this));
        console.log('Chat view registered');

        // Add commands with configurable shortcuts
        this.addCommand({
            id: 'open-claude-chat',
            name: 'Open Claude Chat',
            hotkeys: this.settings.shortcuts.openInterface,
            checkCallback: (checking: boolean) => {
                console.log('Open chat command triggered, checking:', checking);
                if (!checking) {
                    this.activateView();
                }
                return true;
            }
        });

        this.addCommand({
            id: 'open-last-conversation',
            name: 'Open Last Conversation',
            hotkeys: this.settings.shortcuts.openLastConversation,
            checkCallback: (checking: boolean) => {
                console.log('Open last conversation command triggered, checking:', checking);
                if (!checking) {
                    this.openLastConversation();
                }
                return true;
            }
        });

        this.addCommand({
            id: 'new-conversation',
            name: 'Start New Conversation',
            hotkeys: this.settings.shortcuts.newConversation,
            checkCallback: (checking: boolean) => {
                console.log('New conversation command triggered, checking:', checking);
                if (!checking) {
                    this.createNewConversation();
                }
                return true;
            }
        });

        this.addCommand({
            id: 'hide-claude-chat',
            name: 'Hide Claude Chat',
            hotkeys: this.settings.shortcuts.hideInterface,
            checkCallback: (checking: boolean) => {
                console.log('Hide chat command triggered, checking:', checking);
                const leaves = this.app.workspace.getLeavesOfType(CHAT_VIEW_TYPE);
                if (!checking && leaves.length > 0) {
                    this.hideView();
                }
                return leaves.length > 0;
            }
        });

        // Add settings tab
        this.addSettingTab(new ClaudeChatSettingTab(this.app, this));
        console.log('Claude Chat plugin loaded successfully');
    }

    async loadSettings() {
        console.log('Loading settings...');
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
        console.log('Settings loaded:', this.settings);
    }

    async saveSettings() {
        console.log('Saving settings:', this.settings);
        await this.saveData(this.settings);
        console.log('Settings saved successfully');
    }

    async activateView() {
        console.log('Activating chat view...');
        const { workspace } = this.app;
        
        let leaf = workspace.getLeavesOfType(CHAT_VIEW_TYPE)[0];
        if (!leaf) {
            console.log('No existing chat view found, creating new one');
            leaf = workspace.getLeaf('split', 'vertical');
            await leaf.setViewState({ type: CHAT_VIEW_TYPE });
        } else {
            console.log('Found existing chat view');
        }
        workspace.revealLeaf(leaf);
        console.log('Chat view activated');
        return leaf;
    }

    async hideView() {
        console.log('Hiding chat view...');
        const leaves = this.app.workspace.getLeavesOfType(CHAT_VIEW_TYPE);
        console.log(`Found ${leaves.length} chat views to hide`);
        leaves.forEach(leaf => leaf.detach());
        console.log('Chat view(s) hidden');
    }

    async openLastConversation() {
        console.log('Opening last conversation...');
        if (this.settings.currentConversationPath) {
            console.log('Found last conversation:', this.settings.currentConversationPath);
            await this.activateView();
        } else {
            console.log('No last conversation found, creating new one');
            await this.createNewConversation();
        }
    }

    async createNewConversation() {
        console.log('Creating new conversation...');
        try {
            // Ensure the conversation folder exists
            if (!(await this.app.vault.adapter.exists(this.settings.conversationFolder))) {
                console.log('Creating conversation folder:', this.settings.conversationFolder);
                await this.app.vault.createFolder(this.settings.conversationFolder);
            }

            const fileName = `convo-${moment().format('YYYYMMDDHHmmss')}.md`;
            const filePath = `${this.settings.conversationFolder}/${fileName}`;
            console.log('Creating new conversation file:', filePath);
            
            // Create the file with initial content
            await this.app.vault.create(filePath, '# Claude Chat\n\n_Started on ' + moment().format('YYYY-MM-DD HH:mm:ss') + '_\n');
            console.log('Conversation file created');
            
            // Update settings with new conversation path
            this.settings.currentConversationPath = filePath;
            await this.saveSettings();
            console.log('Settings updated with new conversation path');

            // Activate view and focus it
            await this.activateView();
            console.log('New conversation created successfully');

            return true;
        } catch (error) {
            console.error('Error creating new conversation:', error);
            return false;
        }
    }

    async getAllConversations(): Promise<TFile[]> {
        console.log('Getting all conversations...');
        const files = this.app.vault.getFiles();
        const conversations = files.filter(file => 
            file.path.startsWith(this.settings.conversationFolder + '/') && 
            file.path.endsWith('.md')
        );
        console.log('Found conversations:', conversations.map(f => f.path));
        return conversations;
    }

    async switchConversation(filePath: string) {
        console.log('Switching to conversation:', filePath);
        this.settings.currentConversationPath = filePath;
        await this.saveSettings();
        await this.activateView();
        console.log('Switched conversation successfully');
    }

    async sendMessage(message: string, contextFiles: TFile[] = []) {
        console.log('Sending message:', { message, contextFiles });
        
        // Ensure we have a conversation file
        if (!this.settings.currentConversationPath || 
            !(await this.app.vault.adapter.exists(this.settings.currentConversationPath))) {
            console.log('No valid conversation file found, creating new one');
            const success = await this.createNewConversation();
            if (!success || !this.settings.currentConversationPath) {
                console.error('Failed to create conversation file');
                throw new Error('Failed to create conversation file');
            }
        }

        // Get current conversation history
        let conversationHistory = '';
        const currentFile = this.app.vault.getAbstractFileByPath(this.settings.currentConversationPath!);
        if (currentFile instanceof TFile) {
            console.log('Reading conversation history...');
            conversationHistory = await this.app.vault.read(currentFile);
        }

        let contextContent = '';
        if (contextFiles.length > 0) {
            console.log('Processing context files...');
            for (let i = 0; i < contextFiles.length; i++) {
                console.log('Reading context file:', contextFiles[i].path);
                const content = await this.app.vault.read(contextFiles[i]);
                contextContent += `\nContext ${i + 1}: ${contextFiles[i].basename}\n${content}\n`;
            }
        }

        const fullMessage = `!! !! NEW MESSAGE !! !!\n${message}\n\n${
            contextContent ? `++ ++ NEW CONTEXT ++ ++\n${contextContent}\n\n` : ''
        }@@ PREVIOUS DISCUSSION HISTORY @@\n${conversationHistory}`;
        
        console.log('Prepared message:', fullMessage);

        try {
            console.log('Sending request to Claude API...');
            const response = await requestUrl({
                url: 'https://api.anthropic.com/v1/messages',
                method: 'POST',
                headers: {
                    'x-api-key': this.settings.apiKey,
                    'anthropic-version': '2023-06-01',
                    'content-type': 'application/json',
                    'accept': 'application/json'
                },
                body: JSON.stringify({
                    model: "claude-3-5-sonnet-20241022",
                    max_tokens: 4096,
                    temperature: 0.5,
                    messages: [{
                        role: "user",
                        content: [{
                            type: "text",
                            text: fullMessage
                        }]
                    }],
                    system: "The assistant is Claude, created by Anthropic. The current date is March 4th, 2024.\n\nClaude's knowledge base was last updated on August 2023. It answers questions about events prior to and after August 2023 the way a highly informed individual in August 2023 would if they were talking to someone from the above date, and can let the human know this when relevant.\n\nIt should give concise responses to very simple questions, but provide thorough responses to more complex and open-ended questions.\n\nIf it is asked to assist with tasks involving the expression of views held by a significant number of people, Claude provides assistance with the task even if it personally disagrees with the views being expressed, but follows this with a discussion of broader perspectives.\n\nClaude doesn't engage in stereotyping, including the negative stereotyping of majority groups.\n\nIf asked about controversial topics, Claude tries to provide careful thoughts and objective information without downplaying its harmful content or implying that there are reasonable perspectives on both sides.\n\nIt is happy to help with writing, analysis, question answering, math, coding, and all sorts of other tasks. It uses markdown for coding.\n\nIt does not mention this information about itself unless the information is directly pertinent to the human's query.\n\nA new message will be provided, potentially followed by context which should be very carefully considered when pondering about the response and how to come to any decisions. After the new message and context, a full capture of any previous discussion on the topic will be included. If this new message is related to previous discussion, all of that along with new context should be read before giving an answer."
                })
            });

            console.log('Raw API Response:', JSON.stringify(response, null, 2));
            console.log('Response status:', response.status);
            console.log('Response headers:', response.headers);

            if (!response.json || !response.json.content || !response.json.content[0] || !response.json.content[0].text) {
                console.error('Unexpected API response format:', response);
                throw new Error('Invalid API response format');
            }

            const assistantMessage = response.json.content[0].text;
            console.log('Extracted assistant message:', assistantMessage);

            // At this point we know currentConversationPath is not null
            if (currentFile instanceof TFile) {
                console.log('Updating conversation file:', currentFile.path);
                const currentContent = await this.app.vault.read(currentFile);
                const newContent = `${currentContent}\n\n**User**: ${message}\n\n**Claude**: ${assistantMessage}\n`;
                await this.app.vault.modify(currentFile, newContent);
                console.log('Conversation file updated successfully');
                return assistantMessage;
            }
            console.error('Could not find conversation file:', this.settings.currentConversationPath);
            throw new Error('Could not find conversation file');
        } catch (error) {
            console.error('Error sending message to Claude:', error);
            throw error;
        }
    }
} 