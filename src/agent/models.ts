/** A model people may pick for their agent turns, with what the editor's menu says about it */
export interface AgentModelChoice {
    readonly id: string;
    readonly label: string;
}

/** The models the editor offers by default, the cheapest first */
export const AGENT_MODELS: readonly AgentModelChoice[] = [
    { id: 'claude-haiku-5-5', label: 'Haiku 5.5 · fastest, lowest cost' },
    { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5 · balanced' },
    { id: 'claude-opus-5-5', label: 'Opus 5.5 · strongest, highest cost' }
];

/** The menu entry of a model id: a known one's label, or the id itself */
export function modelChoice(id: string): AgentModelChoice {
    return AGENT_MODELS.find((model) => model.id === id) ?? { id, label: id };
}
