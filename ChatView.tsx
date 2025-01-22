import { ItemView, TFile, WorkspaceLeaf, App, MarkdownRenderer, MarkdownView, moment } from 'obsidian';
import * as React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { useState, useEffect, useRef, useCallback } from 'react';
import ClaudeChatPlugin from './main';

export const CHAT_VIEW_TYPE = 'claude-chat';

interface Message {
    role: 'user' | 'assistant';
    content: string;
}

interface ContextSearchProps {
    onSelect: (file: TFile) => void;
    searchText: string;
    selectedFiles: TFile[];
    app: App;
    plugin: ClaudeChatPlugin;
}

const ContextSearch: React.FC<ContextSearchProps> = ({ onSelect, searchText, selectedFiles, app, plugin }) => {
    const [searchResults, setSearchResults] = useState<TFile[]>([]);
    const [previews, setPreviews] = useState<Record<string, string>>({});
    
    useEffect(() => {
        if (!searchText) {
            setSearchResults([]);
            return;
        }

        const files = app.vault.getFiles();
        const results = files
            .filter((file: TFile) => {
                if (selectedFiles.some(selected => selected.path === file.path)) {
                    return false;
                }
                const searchLower = searchText.toLowerCase();
                const pathLower = file.path.toLowerCase();
                const score = fuzzySearch(searchLower, pathLower);
                return score > 0.3;
            })
            .sort((a, b) => {
                const scoreA = fuzzySearch(searchText.toLowerCase(), a.path.toLowerCase());
                const scoreB = fuzzySearch(searchText.toLowerCase(), b.path.toLowerCase());
                return scoreB - scoreA;
            })
            .slice(0, 5);

        setSearchResults(results);

        // Load previews for the search results
        const loadPreviews = async () => {
            const newPreviews: Record<string, string> = {};
            for (const file of results) {
                try {
                    newPreviews[file.path] = await getFilePreview(file, plugin);
                } catch (error) {
                    console.error('Error loading preview:', error);
                    newPreviews[file.path] = 'Error loading preview';
                }
            }
            setPreviews(newPreviews);
        };
        loadPreviews();
    }, [searchText, selectedFiles, app, plugin]);

    if (!searchResults.length) return null;

    return (
        <div className="context-search-results">
            {searchResults.map(file => (
                <div 
                    key={file.path} 
                    className="context-search-result"
                    onClick={() => onSelect(file)}
                >
                    <div className="context-result-path">{file.path}</div>
                    <div className="context-result-preview" 
                         dangerouslySetInnerHTML={{ __html: previews[file.path] || 'Loading...' }} />
                </div>
            ))}
        </div>
    );
};

interface ChatComponentProps {
    plugin: ClaudeChatPlugin;
}

const FilePreview: React.FC<{ file: TFile; plugin: ClaudeChatPlugin }> = ({ file, plugin }) => {
    const [preview, setPreview] = useState<string>('');

    useEffect(() => {
        const loadPreview = async () => {
            try {
                const content = await plugin.app.vault.read(file);
                const previewEl = document.createElement('div');
                const activeView = plugin.app.workspace.getActiveViewOfType(MarkdownView);
                if (activeView) {
                    await MarkdownRenderer.render(
                        plugin.app,
                        content,
                        previewEl,
                        file.path,
                        activeView
                    );
                    setPreview(previewEl.innerHTML);
                }
            } catch (error) {
                console.error('Error loading preview:', error);
                setPreview('Error loading preview');
            }
        };
        loadPreview();
    }, [file, plugin]);

    return <div className="context-result-preview" dangerouslySetInnerHTML={{ __html: preview }} />;
};

export const ChatComponent: React.FC<ChatComponentProps> = ({ plugin }) => {
    const [messages, setMessages] = useState<Message[]>([]);
    const [message, setMessage] = useState('');
    const [contextSearch, setContextSearch] = useState('');
    const [selectedFiles, setSelectedFiles] = useState<TFile[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [conversations, setConversations] = useState<TFile[]>([]);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [renderedMessages, setRenderedMessages] = useState<Record<number, string>>({});

    // Add effect to track open files
    useEffect(() => {
        const handleActiveLeafChange = () => {
            const activeFile = plugin.app.workspace.getActiveFile();
            const allOpenFiles = plugin.settings.includeAllOpenFiles ? 
                getAllOpenFiles(plugin.app) : 
                (activeFile ? [activeFile] : []);

            // Filter out conversation files and non-markdown files
            const validFiles = allOpenFiles.filter(file => 
                file.extension === 'md' && 
                !file.path.startsWith(plugin.settings.conversationFolder)
            );

            // Update selected files, keeping any manually added ones
            setSelectedFiles(prev => {
                const manuallyAdded = prev.filter(f => 
                    !allOpenFiles.some(open => open.path === f.path)
                );
                return [...new Map([...validFiles, ...manuallyAdded].map(file => [file.path, file])).values()];
            });
        };

        // Initial check
        handleActiveLeafChange();

        // Subscribe to workspace events
        plugin.app.workspace.on('active-leaf-change', handleActiveLeafChange);
        plugin.app.workspace.on('layout-change', handleActiveLeafChange);
        
        // Cleanup
        return () => {
            plugin.app.workspace.off('active-leaf-change', handleActiveLeafChange);
            plugin.app.workspace.off('layout-change', handleActiveLeafChange);
        };
    }, [plugin, plugin.settings.includeAllOpenFiles]);

    const handleIncludeAllToggle = async () => {
        plugin.settings.includeAllOpenFiles = !plugin.settings.includeAllOpenFiles;
        await plugin.saveSettings();
        // Force update of selected files
        const activeFile = plugin.app.workspace.getActiveFile();
        const allOpenFiles = plugin.settings.includeAllOpenFiles ? 
            getAllOpenFiles(plugin.app) : 
            (activeFile ? [activeFile] : []);

        // Filter out conversation files and non-markdown files
        const validFiles = allOpenFiles.filter(file => 
            file.extension === 'md' && 
            !file.path.startsWith(plugin.settings.conversationFolder)
        );

        // Update selected files, keeping any manually added ones
        setSelectedFiles(prev => {
            const manuallyAdded = prev.filter(f => 
                !allOpenFiles.some(open => open.path === f.path)
            );
            return [...new Map([...validFiles, ...manuallyAdded].map(file => [file.path, file])).values()];
        });
    };

    const loadCurrentConversation = useCallback(async () => {
        const currentPath = plugin.settings.currentConversationPath;
        if (currentPath) {
            const file = plugin.app.vault.getAbstractFileByPath(currentPath);
            if (file instanceof TFile) {
                try {
                    const content = await plugin.app.vault.read(file);
                    setMessages(parseConversationContent(content));
                } catch (error) {
                    console.error('Error loading conversation:', error);
                }
            }
        }
    }, [plugin]);

    const loadConversations = useCallback(async () => {
        const convos = await plugin.getAllConversations();
        setConversations(convos);
    }, [plugin]);

    useEffect(() => {
        loadCurrentConversation();
        loadConversations();
    }, [loadCurrentConversation, loadConversations]);

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    useEffect(() => {
        const renderMessages = async () => {
            const newRendered: Record<number, string> = {};
            const activeView = plugin.app.workspace.getActiveViewOfType(MarkdownView);
            if (!activeView) return;
            
            for (let i = 0; i < messages.length; i++) {
                const msg = messages[i];
                const div = document.createElement('div');
                try {
                    await MarkdownRenderer.render(
                        plugin.app,
                        msg.content,
                        div,
                        '',
                        activeView
                    );
                    newRendered[i] = div.innerHTML;
                } catch (error) {
                    console.error('Error rendering markdown:', error);
                    newRendered[i] = msg.content;
                }
            }
            setRenderedMessages(newRendered);
        };
        renderMessages();
    }, [messages, plugin]);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!message.trim()) return;

        setError(null);
        setIsLoading(true);
        try {
            // Add user message immediately to UI
            const userMessage: Message = { role: 'user', content: message };
            setMessages(prev => [...prev, userMessage]);
            
            // Send message and get response
            const response = await plugin.sendMessage(message, selectedFiles);
            
            // Add Claude's response to UI
            const assistantMessage: Message = { role: 'assistant', content: response };
            setMessages(prev => [...prev, assistantMessage]);
            
            // Clear input and selected files
            setMessage('');
            setSelectedFiles([]);
            
            // Scroll to bottom after messages update
            setTimeout(scrollToBottom, 100);
        } catch (error) {
            console.error('Error sending message:', error);
            setError('Failed to send message. Please try again.');
            // Remove the user message if there was an error
            setMessages(prev => prev.slice(0, -1));
        } finally {
            setIsLoading(false);
        }
    };

    const handleKeyPress = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSubmit(e);
        }
    };

    const handleFileSelect = (file: TFile) => {
        setSelectedFiles(prev => [...prev, file]);
        setContextSearch('');
    };

    const removeFile = (file: TFile) => {
        setSelectedFiles(prev => prev.filter(f => f.path !== file.path));
    };

    const handleConversationChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
        const path = e.target.value;
        await plugin.switchConversation(path);
        await loadCurrentConversation();
    };

    return (
        <div className="chat-container">
            <div className="conversation-selector">
                <select 
                    value={plugin.settings.currentConversationPath || ''} 
                    onChange={handleConversationChange}
                    className="conversation-dropdown"
                >
                    <option value="">Select a conversation...</option>
                    {conversations.map(file => (
                        <option key={file.path} value={file.path}>
                            {file.basename} - {moment(file.stat.ctime).format('YYYY-MM-DD HH:mm:ss')}
                        </option>
                    ))}
                </select>
                <div className="include-all-toggle">
                    <label>
                        <input
                            type="checkbox"
                            checked={plugin.settings.includeAllOpenFiles}
                            onChange={handleIncludeAllToggle}
                        />
                        Include all open files as context
                    </label>
                </div>
            </div>

            <div className="chat-messages" role="log">
                {messages.map((msg, idx) => (
                    <div key={idx} className={`message ${msg.role}`} role="article">
                        <div className="message-header">{msg.role === 'user' ? 'You' : 'Claude'}</div>
                        <div className="message-content markdown-rendered" 
                             dangerouslySetInnerHTML={{ __html: renderedMessages[idx] || msg.content }} />
                    </div>
                ))}
                <div ref={messagesEndRef} />
            </div>

            {error && <div className="error-message">{error}</div>}
            
            <div className="context-section">
                <div className="selected-contexts">
                    {selectedFiles.map(file => (
                        <div key={file.path} className="selected-context">
                            <div className="context-file-name">{file.basename}</div>
                            <div className="context-file-path">{file.parent?.path}</div>
                            <button 
                                onClick={() => removeFile(file)}
                                aria-label={`Remove ${file.basename} from context`}
                            >×</button>
                        </div>
                    ))}
                </div>
                
                <div className="context-search">
                    <input
                        type="text"
                        placeholder="Search for context files..."
                        value={contextSearch}
                        onChange={e => setContextSearch(e.target.value)}
                        aria-label="Search for context files"
                    />
                    <ContextSearch 
                        searchText={contextSearch}
                        onSelect={handleFileSelect}
                        selectedFiles={selectedFiles}
                        app={plugin.app}
                        plugin={plugin}
                    />
                </div>
            </div>

            <form onSubmit={handleSubmit} className="message-form">
                <textarea
                    ref={textareaRef}
                    value={message}
                    onChange={e => setMessage(e.target.value)}
                    onKeyPress={handleKeyPress}
                    placeholder="Type your message... (Shift+Enter for new line)"
                    disabled={isLoading}
                    rows={1}
                    aria-label="Message input"
                />
                <button 
                    type="submit" 
                    disabled={isLoading || !message.trim()}
                    aria-label={isLoading ? 'Sending message...' : 'Send message'}
                >
                    {isLoading ? 'Sending...' : 'Send'}
                </button>
            </form>
        </div>
    );
};

// Helper functions
function fuzzySearch(pattern: string, str: string): number {
    let score = 0;
    let patternIdx = 0;
    let strIdx = 0;
    let prevMatchingCharIdx = -1;

    while (patternIdx < pattern.length && strIdx < str.length) {
        if (pattern[patternIdx] === str[strIdx]) {
            if (prevMatchingCharIdx === -1 || strIdx === prevMatchingCharIdx + 1) {
                score += 1;
            } else {
                score += 0.5;
            }
            prevMatchingCharIdx = strIdx;
            patternIdx++;
        }
        strIdx++;
    }

    return score / pattern.length;
}

const getFilePreview = async (file: TFile, plugin: ClaudeChatPlugin) => {
    try {
        const content = await plugin.app.vault.read(file);
        const previewEl = document.createElement('div');
        const view = plugin.app.workspace.activeLeaf?.view;
        if (!view) return content;
        
        await MarkdownRenderer.renderMarkdown(content, previewEl, file.path, view);
        return previewEl.innerHTML;
    } catch (error) {
        console.error('Error loading preview:', error);
        return 'Error loading preview';
    }
};

function parseConversationContent(content: string): Message[] {
    const messages: Message[] = [];
    const lines = content.split('\n');
    let currentMessage: Message | null = null;

    for (const line of lines) {
        if (line.startsWith('**User**:')) {
            if (currentMessage) messages.push(currentMessage);
            currentMessage = { role: 'user', content: line.replace('**User**:', '').trim() };
        } else if (line.startsWith('**Claude**:')) {
            if (currentMessage) messages.push(currentMessage);
            currentMessage = { role: 'assistant', content: line.replace('**Claude**:', '').trim() };
        } else if (currentMessage) {
            currentMessage.content += '\n' + line;
        }
    }

    if (currentMessage) messages.push(currentMessage);
    return messages;
}

// Helper function to get all open files
function getAllOpenFiles(app: App): TFile[] {
    const openFiles: Set<TFile> = new Set();
    app.workspace.iterateAllLeaves(leaf => {
        if (leaf.view instanceof MarkdownView && leaf.view.file) {
            openFiles.add(leaf.view.file);
        }
    });
    return Array.from(openFiles);
}

export class ChatView extends ItemView {
    private root: Root | null = null;
    private plugin: ClaudeChatPlugin;
    private container: HTMLElement;

    constructor(leaf: WorkspaceLeaf, plugin: ClaudeChatPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string {
        return CHAT_VIEW_TYPE;
    }

    getDisplayText(): string {
        return 'Claude Chat';
    }

    async onOpen() {
        this.container = this.containerEl.children[1] as HTMLElement;
        this.container.empty();
        this.container.addClass('claude-chat');
        
        this.root = createRoot(this.container);
        this.root.render(
            <ChatComponent plugin={this.plugin} />
        );
    }

    async onClose() {
        if (this.root) {
            this.root.unmount();
        }
    }
} 