import { App, PluginSettingTab, Setting, Hotkey, Modifier } from 'obsidian';
import ClaudeChatPlugin from './main';

export interface ClaudeChatSettings {
    apiKey: string;
    conversationFolder: string;
    currentConversationPath: string | null;
    includeAllOpenFiles: boolean;
    shortcuts: {
        openInterface: Hotkey[];
        openLastConversation: Hotkey[];
        newConversation: Hotkey[];
        hideInterface: Hotkey[];
    };
}

type ShortcutKey = keyof ClaudeChatSettings['shortcuts'];

export const DEFAULT_SETTINGS: ClaudeChatSettings = {
    apiKey: '',
    conversationFolder: 'convos',
    currentConversationPath: null,
    includeAllOpenFiles: false,
    shortcuts: {
        openInterface: [{ modifiers: ["Mod"], key: "O" }],
        openLastConversation: [{ modifiers: ["Mod"], key: "L" }],
        newConversation: [{ modifiers: ["Mod", "Shift"], key: "N" }],
        hideInterface: [{ modifiers: ["Mod"], key: "H" }]
    }
};

export class ClaudeChatSettingTab extends PluginSettingTab {
    plugin: ClaudeChatPlugin;

    constructor(app: App, plugin: ClaudeChatPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl('h2', { text: 'Claude Chat Settings' });

        new Setting(containerEl)
            .setName('API Key')
            .setDesc('Enter your Claude API key')
            .addText(text => text
                .setPlaceholder('Enter your API key')
                .setValue(this.plugin.settings.apiKey)
                .onChange(async (value) => {
                    this.plugin.settings.apiKey = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Conversation Folder')
            .setDesc('Folder where conversations will be saved')
            .addText(text => text
                .setPlaceholder('convos')
                .setValue(this.plugin.settings.conversationFolder)
                .onChange(async (value) => {
                    this.plugin.settings.conversationFolder = value;
                    await this.plugin.saveSettings();
                }));

        containerEl.createEl('h3', { text: 'Keyboard Shortcuts' });

        this.addHotkeySettings(containerEl);
    }

    private addHotkeySettings(containerEl: HTMLElement) {
        const hotkeySettings: Array<{
            name: string;
            desc: string;
            id: string;
            setting: ShortcutKey;
        }> = [
            {
                name: 'Open Interface',
                desc: 'Shortcut to open the Claude chat interface',
                id: 'open-claude-chat',
                setting: 'openInterface'
            },
            {
                name: 'Open Last Conversation',
                desc: 'Shortcut to open the last active conversation',
                id: 'open-last-conversation',
                setting: 'openLastConversation'
            },
            {
                name: 'New Conversation',
                desc: 'Shortcut to start a new conversation',
                id: 'new-conversation',
                setting: 'newConversation'
            },
            {
                name: 'Hide Interface',
                desc: 'Shortcut to hide the Claude chat interface',
                id: 'hide-claude-chat',
                setting: 'hideInterface'
            }
        ];

        hotkeySettings.forEach(({ name, desc, id, setting }) => {
            new Setting(containerEl)
                .setName(name)
                .setDesc(desc)
                .addText(text => text
                    .setPlaceholder('Mod+Key')
                    .setValue(this.formatHotkey(this.plugin.settings.shortcuts[setting]))
                    .onChange(async (value) => {
                        this.plugin.settings.shortcuts[setting] = this.parseHotkey(value);
                        await this.plugin.saveSettings();
                        // Update command palette
                        const command = (this.app as any).commands.commands[`claude-plugin:${id}`];
                        if (command) {
                            command.hotkeys = this.plugin.settings.shortcuts[setting];
                        }
                    }));
        });
    }

    private formatHotkey(hotkeys: Hotkey[]): string {
        if (!hotkeys || !hotkeys.length) return '';
        const hotkey = hotkeys[0];
        return [...hotkey.modifiers, hotkey.key].join('+');
    }

    private parseHotkey(value: string): Hotkey[] {
        if (!value) return [];
        const parts = value.split('+').map(p => p.trim());
        const key = parts.pop() || '';
        const modifiers = parts as Modifier[];
        return [{ modifiers, key }];
    }
} 